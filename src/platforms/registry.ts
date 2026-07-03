import type {
    Platform,
    PublishResult,
    PublishContent,
    PublishedMessageRef,
} from './types';
import type { ChannelOption, PlatformMeta } from '../../shared/types';
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

export function listPlatformsMeta(): PlatformMeta[] {
    return [...platforms.values()].map((platform) => {
        const meta: PlatformMeta = {
            id: platform.id,
            name: platform.name,
            icon: platform.icon,
            charLimit: platform.charLimit,
        };
        if (platform.setup) meta.setup = platform.setup;
        return meta;
    });
}

/** Aggregate the channel options of every configured platform for the picker. */
export async function listAllChannels(userId: string): Promise<ChannelOption[]> {
    const options: ChannelOption[] = [];

    const managed = await listChannelResources(userId);
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

/**
 * Attach a message link to each successful result, if the adapter can build one.
 * `buildMessageLink` is stateless/synchronous, so it can only use server-wide (.env)
 * config — it never overrides a link the adapter already resolved per-user inside
 * publish()/update() itself.
 */
function withLinks(
    platform: Platform,
    results: PublishResult[],
): PublishResult[] {
    if (!platform.buildMessageLink) return results;
    return results.map((result) => {
        if (!result.ok || !result.messageIds?.length || result.link) return result;
        const link =
            platform.buildMessageLink!(result.channelId, result.messageIds[0]) ??
            undefined;
        return link ? { ...result, link } : result;
    });
}

export interface PublishTarget {
    platform: string;
    channelId: string;
}

/** Fan a single post out to a set of {platform, channelId} targets. */
export async function publishToTargets(
    targets: PublishTarget[],
    content: PublishContent,
    userId?: string,
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
            results.push(
                ...withLinks(
                    platform,
                    await platform.publish(channelIds, content, { userId }),
                ),
            );
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
    userId?: string,
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
            results.push(
                ...withLinks(
                    platform,
                    await platform.update(refs, content, { userId }),
                ),
            );
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
    userId?: string,
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
            results.push(...(await platform.delete(refs, { userId })));
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
