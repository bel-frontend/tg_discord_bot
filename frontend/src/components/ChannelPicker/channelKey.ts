export function channelKey(t: { platform: string; channelId: string }): string {
    return `${t.platform}:${t.channelId}`;
}

export function channelOptionKey(ch: {
    platform: string;
    id: string;
}): string {
    return channelKey({ platform: ch.platform, channelId: ch.id });
}
