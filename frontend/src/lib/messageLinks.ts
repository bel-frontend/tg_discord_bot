import type { ChannelOption, PublicationTarget } from '../../../shared/types';

/**
 * Build a clickable URL to the published message for a single target, or null
 * if this platform/channel combination can't be linked (e.g. a private Telegram
 * chat id, or Discord without a known guild id), or the target failed to publish.
 */
export function buildMessageUrl(
    target: PublicationTarget,
    channels: ChannelOption[],
): string | null {
    if (!target.ok || !target.messageIds.length) return null;
    const messageId = target.messageIds[0];

    if (target.platform === 'telegram') {
        if (!target.channelId.startsWith('@')) return null;
        const username = target.channelId.slice(1);
        return `https://t.me/${username}/${messageId}`;
    }

    if (target.platform === 'discord') {
        const channel = channels.find(
            (c) => c.platform === 'discord' && c.id === target.channelId,
        );
        if (!channel?.guildId) return null;
        return `https://discord.com/channels/${channel.guildId}/${target.channelId}/${messageId}`;
    }

    return null;
}
