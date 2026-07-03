import TelegramBot from 'node-telegram-bot-api';
import type {
    Channel,
    Platform,
    PlatformContext,
    PublishContent,
    PublishedMessageRef,
    PublishResult,
    ValidationIssue,
} from './types';
import { getPlatformConfigValues } from '../platformConfigs';
import { markdownToTelegramHtml } from './telegram/markdown';
import { splitTextIntoChunks, TELEGRAM_LIMIT } from '../chunk';
import { isValidTelegramHtml, validateTelegramHtml } from '../telegramValidation';

/** True when a Telegram API error means "this channel just isn't reachable" (skip, don't crash). */
function isChannelError(error: any): boolean {
    return (
        error?.code === 'ETELEGRAM' &&
        (error.response?.body?.error_code === 400 ||
            error.response?.body?.error_code === 403 ||
            error.response?.body?.description?.includes('chat not found') ||
            error.response?.body?.description?.includes('not enough rights') ||
            error.response?.body?.description?.includes('username not found'))
    );
}

function lineInfo(markdown: string, index: number) {
    const before = markdown.slice(0, Math.max(0, index));
    const line = before.split('\n').length;
    const lineStart = markdown.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
    const nextNewline = markdown.indexOf('\n', index);
    const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
    return {
        line,
        excerpt: markdown.slice(lineStart, lineEnd).trim(),
    };
}

function findLikelyMarkdownSource(markdown: string, tag?: string) {
    const checks: Array<[RegExp, string[]]> = [
        [/^>\s?.+/m, ['blockquote']],
        [/```[\s\S]*?```/, ['pre']],
        [/`[^`\n]+`/, ['code']],
        [/\|\|[\s\S]+?\|\|/, ['tg-spoiler']],
        [/__[\s\S]+?__/, ['u', 'ins']],
        [/\*\*[\s\S]+?\*\*/, ['b', 'strong']],
        [/~~[\s\S]+?~~/, ['s', 'strike', 'del']],
        [/\*[^*\n]+?\*/, ['i', 'em']],
        [/\[[^\]]+]\([^)]+\)/, ['a']],
    ];

    for (const [pattern, tags] of checks) {
        if (tag && !tags.includes(tag)) continue;
        const match = pattern.exec(markdown);
        if (match?.index !== undefined) return lineInfo(markdown, match.index);
    }

    return undefined;
}

function htmlContext(chunk: string, offset?: number) {
    if (offset === undefined) return undefined;
    const start = Math.max(0, offset - 80);
    const end = Math.min(chunk.length, offset + 140);
    return chunk.slice(start, end);
}

function telegramErrorDescription(error: any): string {
    return error?.response?.body?.description || error?.message || '';
}

export class TelegramPlatform implements Platform {
    readonly id = 'telegram';
    readonly name = 'Telegram';
    readonly icon = '✈️';
    readonly charLimit = TELEGRAM_LIMIT;
    readonly setup = {
        summary:
            'Publishes through a Telegram bot that is added to each target channel or chat.',
        configFields: [
            {
                name: 'TELEGRAM_BOT_TOKEN',
                label: 'Bot token',
                required: true,
                secret: true,
                description: 'Token from BotFather for the bot that will post.',
                placeholder: '123456:ABC...',
            },
        ],
        steps: [
            'Open [BotFather](https://t.me/BotFather) in Telegram, send /newbot, and follow the prompts to create a bot.',
            'Copy the token BotFather gives you, paste it into the "Bot token" field above, and click Save.',
            'Add the bot to the channel or group you want to post to, and give it permission to post messages.',
            'Go to Resources and add that channel/group as a Telegram resource — use its @username (e.g. @public_channel), or a numeric chat id (e.g. -1001234567890) for private channels/chats.',
            'It will now show up in the channel picker whenever you publish or schedule a post.',
        ],
        docsUrl: 'https://core.telegram.org/bots',
        notes: [
            "Telegram bots can't list every channel they belong to, so each target must be added on the Resources page.",
        ],
    };
    private bot: TelegramBot | null = null;

    constructor(private token = '') {}

    isConfigured(): boolean {
        return Boolean(this.token);
    }

    toPreviewHtml(markdown: string): string {
        return markdownToTelegramHtml(markdown);
    }

    validateContent(markdown: string): ValidationIssue[] {
        const html = markdownToTelegramHtml(markdown);
        const chunks = splitTextIntoChunks(html, TELEGRAM_LIMIT, true);
        return chunks.flatMap((chunk, index) =>
            validateTelegramHtml(chunk).map((issue) => {
                const source = findLikelyMarkdownSource(markdown, issue.tag);
                return {
                    platform: this.id,
                    chunk: index + 1,
                    ...issue,
                    line: source?.line,
                    excerpt: source?.excerpt,
                    htmlContext: htmlContext(chunk, issue.offset),
                };
            }),
        );
    }

    buildMessageLink(channelId: string, messageId: string): string | null {
        if (!channelId.startsWith('@')) return null;
        const username = channelId.slice(1);
        return `https://t.me/${username}/${messageId}`;
    }

    private async resolveToken(context?: PlatformContext): Promise<string> {
        const values = await getPlatformConfigValues(context?.accountId, this.id);
        return values.TELEGRAM_BOT_TOKEN || this.token;
    }

    private getBot(token: string): TelegramBot {
        if (token !== this.token) {
            return new TelegramBot(token, { polling: false });
        }
        if (!this.bot) {
            this.bot = new TelegramBot(this.token, { polling: false });
        }
        return this.bot;
    }

    async listChannels(_context?: PlatformContext): Promise<Channel[]> {
        // Telegram bots cannot enumerate the channels they're in.
        // Add Telegram channels on the Resources page so they are stored in MongoDB.
        return [];
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const token = await this.resolveToken(context);
        if (!token) throw new Error('Telegram bot token is not configured');
        const bot = this.getBot(token);
        const html = markdownToTelegramHtml(content.markdown);
        const chunks = splitTextIntoChunks(html, TELEGRAM_LIMIT, true);
        const invalidChunk = chunks.find(
            (chunk) => !isValidTelegramHtml(chunk),
        );
        if (invalidChunk) {
            const issue = validateTelegramHtml(invalidChunk)[0];
            throw new Error(
                `Telegram HTML is invalid: ${issue?.message ?? 'unknown parse error'}`,
            );
        }

        // Photo sources: remote URLs (strings) + uploaded buffers.
        const photos: Array<{
            source: string | Buffer;
            filename?: string;
            contentType?: string;
        }> = [
            ...(content.imageUrls ?? []).map((url) => ({ source: url })),
            ...(content.images ?? []).map((img) => ({
                source: Buffer.from(img.data),
                filename: img.filename,
                contentType: img.contentType,
            })),
        ];

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            const id = channelId.trim();
            if (!id) continue;
            const messageIds: string[] = [];
            try {
                if (photos.length) {
                    // Photo caption is limited to 1024 chars. Never slice HTML blindly:
                    // it can cut a tag (e.g. <blockquote>) and Telegram will reject it.
                    const firstChunk = chunks[0] ?? '';
                    const canUseCaption =
                        firstChunk.length <= 1024 &&
                        isValidTelegramHtml(firstChunk);
                    for (let i = 0; i < photos.length; i++) {
                        const opts: TelegramBot.SendPhotoOptions =
                            i === 0 && canUseCaption
                                ? {
                                      caption: firstChunk,
                                      parse_mode: 'HTML',
                                  }
                                : {};
                        const message = await bot.sendPhoto(
                            id,
                            photos[i].source,
                            opts,
                            photos[i].filename
                                ? {
                                      filename: photos[i].filename,
                                      contentType: photos[i].contentType,
                                  }
                                : undefined,
                        );
                        messageIds.push(String(message.message_id));
                    }
                    for (const chunk of chunks.slice(canUseCaption ? 1 : 0)) {
                        const message = await bot.sendMessage(id, chunk, {
                            parse_mode: 'HTML',
                        });
                        messageIds.push(String(message.message_id));
                    }
                } else {
                    for (const chunk of chunks) {
                        const message = await bot.sendMessage(id, chunk, {
                            parse_mode: 'HTML',
                        });
                        messageIds.push(String(message.message_id));
                    }
                }
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: true,
                    messageIds,
                });
            } catch (error: any) {
                const message = isChannelError(error)
                    ? error.response?.body?.description || error.message
                    : error?.message || 'Send failed';
                if (!isChannelError(error)) {
                    console.error(
                        `Error sending to Telegram channel ${id}:`,
                        error,
                    );
                }
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: false,
                    error: message,
                });
            }
        }
        return results;
    }

    async update(
        refs: PublishedMessageRef[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const token = await this.resolveToken(context);
        if (!token) throw new Error('Telegram bot token is not configured');
        const bot = this.getBot(token);
        const html = markdownToTelegramHtml(content.markdown);
        const chunks = splitTextIntoChunks(html, TELEGRAM_LIMIT, true);
        const results: PublishResult[] = [];

        for (const ref of refs) {
            const [messageId] = ref.messageIds;
            if (!messageId) {
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    error: 'No Telegram message id stored',
                });
                continue;
            }
            if (chunks.length !== 1) {
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    error: 'Update is supported only for posts that fit in one Telegram message',
                });
                continue;
            }

            try {
                try {
                    await bot.editMessageText(chunks[0], {
                        chat_id: ref.channelId,
                        message_id: Number(messageId),
                        parse_mode: 'HTML',
                    });
                } catch (error: any) {
                    const description =
                        error?.response?.body?.description || '';
                    if (!description.includes('no text in the message')) {
                        throw error;
                    }
                    await bot.editMessageCaption(chunks[0], {
                        chat_id: ref.channelId,
                        message_id: Number(messageId),
                        parse_mode: 'HTML',
                    });
                }
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: true,
                    messageIds: ref.messageIds,
                });
            } catch (error: any) {
                const description = telegramErrorDescription(error);
                if (description.includes('message is not modified')) {
                    results.push({
                        platform: this.id,
                        channelId: ref.channelId,
                        ok: true,
                        messageIds: ref.messageIds,
                    });
                    continue;
                }
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: description || 'Update failed',
                });
            }
        }

        return results;
    }

    async delete(
        refs: PublishedMessageRef[],
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const token = await this.resolveToken(context);
        if (!token) throw new Error('Telegram bot token is not configured');
        const bot = this.getBot(token);
        const results: PublishResult[] = [];

        for (const ref of refs) {
            try {
                for (const messageId of ref.messageIds) {
                    await bot.deleteMessage(ref.channelId, Number(messageId));
                }
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: true,
                    messageIds: ref.messageIds,
                });
            } catch (error: any) {
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: error?.response?.body?.description || error?.message || 'Delete failed',
                });
            }
        }

        return results;
    }
}
