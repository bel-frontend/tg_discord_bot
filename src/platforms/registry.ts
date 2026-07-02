import type {
    Platform,
    PublishResult,
    PublishContent,
    PublishedMessageRef,
} from './types';
import type { ChannelOption } from '../../shared/types';
import { listChannelResources } from '../channelResources';

const platforms = new Map<string, Platform>();

export function register(platform: Platform): void {
    platforms.set(platform.id, platform);
}

export function getPlatform(id: string): Platform | undefined {
    return platforms.get(id);
}

export function listPlatforms(): Platform[] {
    return [...platforms.values()];
}

/** Discord's guild id is a single bot-wide env var, needed client-side to link to a published message. */
function discordGuildId(): string | undefined {
    return process.env.DISCORD_GUILD_ID || undefined;
}

/** Aggregate the channel options of every configured platform for the picker. */
export async function listAllChannels(): Promise<ChannelOption[]> {
    const options: ChannelOption[] = [];

    const managed = await listChannelResources();
    const seen = new Set<string>();

    for (const channel of managed) {
        const platform = platforms.get(channel.platform);
        const platformName = platform?.name ?? channel.platform;
        options.push({
            platform: channel.platform,
            platformName,
            id: channel.channelId,
            name: channel.name,
            resourceId: channel.resourceId,
            source: 'db',
            guildId: channel.platform === 'discord' ? discordGuildId() : undefined,
        });
        seen.add(`${channel.platform}:${channel.channelId}`);
    }

    for (const platform of platforms.values()) {
        if (!platform.isConfigured()) continue;
        try {
            const channels = await platform.listChannels();
            for (const channel of channels) {
                const key = `${platform.id}:${channel.id}`;
                if (seen.has(key)) continue;
                options.push({
                    platform: platform.id,
                    platformName: platform.name,
                    id: channel.id,
                    name: channel.name,
                    source: 'config',
                    guildId: platform.id === 'discord' ? discordGuildId() : undefined,
                });
                seen.add(key);
            }
        } catch (error) {
            console.error(
                `Failed to list channels for platform ${platform.id}:`,
                error,
            );
        }
    }
    return options;
}

export interface PublishTarget {
    platform: string;
    channelId: string;
}

/** Fan a single post out to a set of {platform, channelId} targets. */
export async function publishToTargets(
    targets: PublishTarget[],
    content: PublishContent,
): Promise<PublishResult[]> {
    // Group channel ids by platform so each adapter is called once.
    const byPlatform = new Map<string, string[]>();
    for (const target of targets) {
        const list = byPlatform.get(target.platform) ?? [];
        list.push(target.channelId);
        byPlatform.set(target.platform, list);
    }

    const results: PublishResult[] = [];
    for (const [platformId, channelIds] of byPlatform) {
        const platform = platforms.get(platformId);
        if (!platform) {
            results.push(
                ...channelIds.map((channelId) => ({
                    platform: platformId,
                    channelId,
                    ok: false,
                    error: `Unknown platform "${platformId}"`,
                })),
            );
            continue;
        }
        try {
            results.push(...(await platform.publish(channelIds, content)));
        } catch (error: any) {
            results.push(
                ...channelIds.map((channelId) => ({
                    platform: platformId,
                    channelId,
                    ok: false,
                    error: error?.message ?? 'Publish failed',
                })),
            );
        }
    }
    return results;
}

export interface ExistingPublishTarget extends PublishTarget {
    messageIds: string[];
}

export async function updateTargets(
    targets: ExistingPublishTarget[],
    content: PublishContent,
): Promise<PublishResult[]> {
    const byPlatform = new Map<string, PublishedMessageRef[]>();
    for (const target of targets) {
        const list = byPlatform.get(target.platform) ?? [];
        list.push({
            channelId: target.channelId,
            messageIds: target.messageIds,
        });
        byPlatform.set(target.platform, list);
    }

    const results: PublishResult[] = [];
    for (const [platformId, refs] of byPlatform) {
        const platform = platforms.get(platformId);
        if (!platform) {
            results.push(
                ...refs.map((ref) => ({
                    platform: platformId,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: `Unknown platform "${platformId}"`,
                })),
            );
            continue;
        }
        if (!platform.update) {
            results.push(
                ...refs.map((ref) => ({
                    platform: platformId,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: `${platform.name} does not support updates yet`,
                })),
            );
            continue;
        }
        try {
            results.push(...(await platform.update(refs, content)));
        } catch (error: any) {
            results.push(
                ...refs.map((ref) => ({
                    platform: platformId,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: error?.message ?? 'Update failed',
                })),
            );
        }
    }
    return results;
}

export async function deleteTargets(
    targets: ExistingPublishTarget[],
): Promise<PublishResult[]> {
    const byPlatform = new Map<string, PublishedMessageRef[]>();
    for (const target of targets) {
        const list = byPlatform.get(target.platform) ?? [];
        list.push({
            channelId: target.channelId,
            messageIds: target.messageIds,
        });
        byPlatform.set(target.platform, list);
    }

    const results: PublishResult[] = [];
    for (const [platformId, refs] of byPlatform) {
        const platform = platforms.get(platformId);
        if (!platform) {
            results.push(
                ...refs.map((ref) => ({
                    platform: platformId,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: `Unknown platform "${platformId}"`,
                })),
            );
            continue;
        }
        if (!platform.delete) {
            results.push(
                ...refs.map((ref) => ({
                    platform: platformId,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: `${platform.name} does not support deletes yet`,
                })),
            );
            continue;
        }
        try {
            results.push(...(await platform.delete(refs)));
        } catch (error: any) {
            results.push(
                ...refs.map((ref) => ({
                    platform: platformId,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: error?.message ?? 'Delete failed',
                })),
            );
        }
    }
    return results;
}
