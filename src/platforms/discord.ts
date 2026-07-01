import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import type { TextChannel } from 'discord.js';
import type { Channel, Platform, PublishContent, PublishResult } from './types';
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
        const imageUrls = content.imageUrls;

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            const id = channelId.trim();
            if (!id) continue;
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
                    const payload: { content: string; files?: string[] } = {
                        content: chunks[i],
                    };
                    if (imageUrls?.length && i === 0) payload.files = imageUrls;
                    await textChannel.send(payload);
                }
                results.push({ platform: this.id, channelId: id, ok: true });
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
}
