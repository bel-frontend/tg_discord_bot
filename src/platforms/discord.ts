import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import type { TextChannel } from 'discord.js';
import type {
    Channel,
    Platform,
    PublishContent,
    PublishedMessageRef,
    PublishResult,
} from './types';
import { getConfiguredChannels } from '../channels';
import { markdownToDiscord } from '../converters/markdown';
import { splitTextIntoChunks, DISCORD_LIMIT } from '../chunk';

export class DiscordPlatform implements Platform {
    readonly id = 'discord';
    readonly name = 'Discord';
    private client: Client | null = null;
    private ready: Promise<void> | null = null;

    constructor(
        private token = process.env.DISCORD_BOT_TOKEN || '',
        private guildId = process.env.DISCORD_GUILD_ID || '',
    ) {}

    isConfigured(): boolean {
        return Boolean(this.token);
    }

    /** Log in once and reuse the connection for both listing and publishing. */
    private getClient(): Promise<Client> {
        if (!this.client) {
            this.client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                ],
            });
            this.ready = new Promise((resolve, reject) => {
                this.client!.once('ready', () => resolve());
                this.client!.once('error', reject);
                this.client!.login(this.token).catch(reject);
            });
        }
        return this.ready!.then(() => this.client!);
    }

    async listChannels(): Promise<Channel[]> {
        const configured = getConfiguredChannels(this.id);
        if (!this.guildId) return configured;

        try {
            const client = await this.getClient();
            const guild = await client.guilds.fetch(this.guildId);
            const channels = await guild.channels.fetch();
            const live: Channel[] = [];
            for (const channel of channels.values()) {
                if (channel && channel.type === ChannelType.GuildText) {
                    live.push({ id: channel.id, name: `#${channel.name}` });
                }
            }
            // Merge: live channels first, then any configured ones not already present.
            const seen = new Set(live.map((c) => c.id));
            for (const c of configured) {
                if (!seen.has(c.id)) live.push(c);
            }
            return live;
        } catch (error) {
            console.error('Failed to fetch Discord channels live:', error);
            return configured;
        }
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
    ): Promise<PublishResult[]> {
        const client = await this.getClient();
        const text = markdownToDiscord(content.markdown);
        const chunks = splitTextIntoChunks(text, DISCORD_LIMIT, true);

        // Attachments: remote URLs (strings) + uploaded buffers.
        const files: Array<string | { attachment: Buffer; name: string }> = [
            ...(content.imageUrls ?? []),
            ...(content.images ?? []).map((img) => ({
                attachment: Buffer.from(img.data),
                name: img.filename,
            })),
        ];

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            const id = channelId.trim();
            if (!id) continue;
            const messageIds: string[] = [];
            try {
                const channel = await client.channels.fetch(id);
                if (!channel?.isTextBased() || channel.isDMBased()) {
                    results.push({
                        platform: this.id,
                        channelId: id,
                        ok: false,
                        error: 'Channel not found or not a text channel',
                    });
                    continue;
                }
                const textChannel = channel as TextChannel;
                for (let i = 0; i < chunks.length; i++) {
                    const payload: { content: string; files?: typeof files } = {
                        content: chunks[i],
                    };
                    if (files.length && i === 0) payload.files = files;
                    const message = await textChannel.send(payload as any);
                    messageIds.push(message.id);
                }
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: true,
                    messageIds,
                });
            } catch (error: any) {
                const skippable =
                    error.code === 10003 ||
                    error.code === 50001 ||
                    error.code === 50013;
                if (!skippable) {
                    console.error(
                        `Error sending to Discord channel ${id}:`,
                        error,
                    );
                }
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: false,
                    error: error?.message || 'Send failed',
                });
            }
        }
        return results;
    }

    async update(
        refs: PublishedMessageRef[],
        content: PublishContent,
    ): Promise<PublishResult[]> {
        const client = await this.getClient();
        const text = markdownToDiscord(content.markdown);
        const chunks = splitTextIntoChunks(text, DISCORD_LIMIT, true);
        const results: PublishResult[] = [];

        for (const ref of refs) {
            const [messageId] = ref.messageIds;
            if (!messageId) {
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    error: 'No Discord message id stored',
                });
                continue;
            }
            if (chunks.length !== 1) {
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    error: 'Update is supported only for posts that fit in one Discord message',
                });
                continue;
            }

            try {
                const channel = await client.channels.fetch(ref.channelId);
                if (!channel?.isTextBased() || channel.isDMBased()) {
                    throw new Error('Channel not found or not a text channel');
                }
                const message = await (channel as TextChannel).messages.fetch(
                    messageId,
                );
                await message.edit({ content: chunks[0] });
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
                    error: error?.message || 'Update failed',
                });
            }
        }

        return results;
    }

    async delete(refs: PublishedMessageRef[]): Promise<PublishResult[]> {
        const client = await this.getClient();
        const results: PublishResult[] = [];

        for (const ref of refs) {
            try {
                const channel = await client.channels.fetch(ref.channelId);
                if (!channel?.isTextBased() || channel.isDMBased()) {
                    throw new Error('Channel not found or not a text channel');
                }
                for (const messageId of ref.messageIds) {
                    const message = await (channel as TextChannel).messages.fetch(
                        messageId,
                    );
                    await message.delete();
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
                    error: error?.message || 'Delete failed',
                });
            }
        }

        return results;
    }
}
