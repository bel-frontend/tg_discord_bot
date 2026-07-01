import TelegramBot from 'node-telegram-bot-api';
import type { Channel, Platform, PublishContent, PublishResult } from './types';
import { getConfiguredChannels } from '../channels';
import { markdownToTelegramHtml } from '../converters/markdown';
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

export class TelegramPlatform implements Platform {
    readonly id = 'telegram';
    readonly name = 'Telegram';
    private bot: TelegramBot | null = null;

    constructor(private token = process.env.TELEGRAM_BOT_TOKEN || '') {}

    isConfigured(): boolean {
        return Boolean(this.token);
    }

    private getBot(): TelegramBot {
        if (!this.bot) {
            this.bot = new TelegramBot(this.token, { polling: false });
        }
        return this.bot;
    }

    async listChannels(): Promise<Channel[]> {
        // Telegram bots cannot enumerate the channels they're in — use the config.
        return getConfiguredChannels(this.id);
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
    ): Promise<PublishResult[]> {
        const bot = this.getBot();
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
                        await bot.sendPhoto(
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
                    }
                    for (const chunk of chunks.slice(canUseCaption ? 1 : 0)) {
                        await bot.sendMessage(id, chunk, { parse_mode: 'HTML' });
                    }
                } else {
                    for (const chunk of chunks) {
                        await bot.sendMessage(id, chunk, { parse_mode: 'HTML' });
                    }
                }
                results.push({ platform: this.id, channelId: id, ok: true });
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
}
