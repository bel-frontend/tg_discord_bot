import TelegramBot from 'node-telegram-bot-api';
import type { Channel, Platform, PublishContent, PublishResult } from './types';
import { getConfiguredChannels } from '../channels';
import { markdownToTelegramHtml } from '../converters/markdown';
import { splitTextIntoChunks, TELEGRAM_LIMIT } from '../chunk';

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
        const firstImage = content.imageUrls?.[0];

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            const id = channelId.trim();
            if (!id) continue;
            try {
                if (firstImage) {
                    // Photo caption is limited to 1024 chars; send the photo with the
                    // first chunk as caption, then any remaining chunks as messages.
                    await bot.sendPhoto(id, firstImage, {
                        caption: chunks[0]?.slice(0, 1024),
                        parse_mode: 'HTML',
                    });
                    for (const chunk of chunks.slice(1)) {
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
