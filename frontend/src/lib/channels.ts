import type { ChannelOption } from '../../../shared/types';

/** Look up a channel's display name by platform+id; falls back to the raw id if unknown. */
export function findChannelName(
    channels: ChannelOption[],
    platform: string,
    channelId: string,
): string {
    return (
        channels.find((c) => c.platform === platform && c.id === channelId)
            ?.name || channelId
    );
}
