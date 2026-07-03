import { Client, GatewayIntentBits, ChannelType } from 'discord.js';
import type { TextChannel } from 'discord.js';
import type {
    Channel,
    Platform,
    PlatformContext,
    PublishContent,
    PublishedMessageRef,
    PublishResult,
} from './types';
import { getConfiguredChannels } from '../channels';
import { getPlatformConfigValues } from '../platformConfigs';
import {
    markdownToDiscord,
    markdownToDiscordPreviewHtml,
} from './discord/markdown';
import { splitTextIntoChunks, DISCORD_LIMIT } from '../chunk';

export class DiscordPlatform implements Platform {
    readonly id = 'discord';
    readonly name = 'Discord';
    readonly icon = '🎮';
    readonly charLimit = DISCORD_LIMIT;
    readonly setup = {
        summary:
            'Publishes through a Discord bot installed in your server with message permissions.',
        env: [
            {
                name: 'DISCORD_BOT_TOKEN',
                required: true,
                description:
                    'Bot token from the Discord Developer Portal. Keep it private.',
            },
            {
                name: 'DISCORD_GUILD_ID',
                required: false,
                description:
                    'Server id. When set, Composer can load text channels live from that server.',
            },
            {
                name: 'DISCORD_CHANNEL_IDS',
                required: false,
                description:
                    'Optional picker entries: channel ids or "id|Name" values separated by commas.',
            },
        ],
        configFields: [
            {
                name: 'DISCORD_BOT_TOKEN',
                label: 'Bot token',
                required: true,
                secret: true,
                description:
                    'Discord bot token from the Developer Portal.',
                placeholder: 'Bot token',
            },
            {
                name: 'DISCORD_GUILD_ID',
                label: 'Server id',
                required: false,
                description:
                    'Optional server id for message links and live channel discovery.',
                placeholder: '123456789012345678',
            },
        ],
        channelIdLabel: 'Discord channel id',
        channelIdHelp:
            'Enable Developer Mode in Discord, then copy the target text channel id.',
        steps: [
            'Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and add a bot.',
            'Paste the bot token into this Settings form. DISCORD_BOT_TOKEN in .env is only a server-wide fallback.',
            'Invite the bot to your server with permission to view channels and send messages.',
            'Save the server id here or set DISCORD_GUILD_ID if you want a server-wide fallback.',
            'Add channel ids through DISCORD_CHANNEL_IDS or create Discord resources here.',
        ],
        docsUrl: 'https://discord.com/developers/docs/intro',
        notes: [
            'The bot can publish only to text channels it can see and where it has Send Messages permission.',
        ],
    };
    private client: Client | null = null;
    private ready: Promise<void> | null = null;

    constructor(
        private token = process.env.DISCORD_BOT_TOKEN || '',
        private guildId = process.env.DISCORD_GUILD_ID || '',
    ) {}

    isConfigured(): boolean {
        return Boolean(this.token);
    }

    toPreviewHtml(markdown: string): string {
        return markdownToDiscordPreviewHtml(markdown);
    }

    buildMessageLink(channelId: string, messageId: string): string | null {
        if (!this.guildId) return null;
        return `https://discord.com/channels/${this.guildId}/${channelId}/${messageId}`;
    }

    private async resolveConfig(context?: PlatformContext): Promise<{
        token: string;
        guildId: string;
    }> {
        const values = await getPlatformConfigValues(context?.userId, this.id);
        return {
            token: values.DISCORD_BOT_TOKEN || this.token,
            guildId: values.DISCORD_GUILD_ID || this.guildId,
        };
    }

    /** Log in once and reuse the env connection for both listing and publishing. */
    private getClient(token = this.token): Promise<Client> {
        if (token !== this.token) {
            return this.createClient(token);
        }
        if (!this.client) {
            this.client = this.buildClient();
            this.ready = this.loginClient(this.client, this.token);
        }
        return this.ready!.then(() => this.client!);
    }

    private buildClient(): Client {
        return new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
            ],
        });
    }

    private loginClient(client: Client, token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            client.once('ready', () => resolve());
            client.once('error', reject);
            client.login(token).catch(reject);
        });
    }

    private async createClient(token: string): Promise<Client> {
        const client = this.buildClient();
        await this.loginClient(client, token);
        return client;
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
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const { token } = await this.resolveConfig(context);
        if (!token) throw new Error('Discord bot token is not configured');
        const client = await this.getClient(token);
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
        if (token !== this.token) client.destroy();
        return results;
    }

    async update(
        refs: PublishedMessageRef[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const { token } = await this.resolveConfig(context);
        if (!token) throw new Error('Discord bot token is not configured');
        const client = await this.getClient(token);
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

        if (token !== this.token) client.destroy();
        return results;
    }

    async delete(
        refs: PublishedMessageRef[],
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const { token } = await this.resolveConfig(context);
        if (!token) throw new Error('Discord bot token is not configured');
        const client = await this.getClient(token);
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

        if (token !== this.token) client.destroy();
        return results;
    }
}
