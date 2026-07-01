import type { Platform, PublishResult, PublishContent } from './types';

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

export interface ChannelOption {
    platform: string; // platform id
    platformName: string; // platform display name
    id: string; // channel id
    name: string; // channel name
}

/** Aggregate the channel options of every configured platform for the picker. */
export async function listAllChannels(): Promise<ChannelOption[]> {
    const options: ChannelOption[] = [];
    for (const platform of platforms.values()) {
        if (!platform.isConfigured()) continue;
        try {
            const channels = await platform.listChannels();
            for (const channel of channels) {
                options.push({
                    platform: platform.id,
                    platformName: platform.name,
                    id: channel.id,
                    name: channel.name,
                });
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
