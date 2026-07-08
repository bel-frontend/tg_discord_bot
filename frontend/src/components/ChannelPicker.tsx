import { useEffect, useMemo, useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import type { ChannelOption, PlatformMeta, Target } from '../../../shared/types';

const PINNED_CHANNELS_STORAGE_KEY = 'composer:pinnedChannels';

export function platformIcon(id: string, platforms: PlatformMeta[]): string {
    return platforms.find((p) => p.id === id)?.icon ?? '🌐';
}

function key(t: { platform: string; channelId: string }): string {
    return `${t.platform}:${t.channelId}`;
}

interface Props {
    channels: ChannelOption[];
    platforms: PlatformMeta[];
    selected: Target[];
    onChange: (next: Target[]) => void;
}

function readPinnedChannelKeys(): string[] {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(PINNED_CHANNELS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : [];
    } catch {
        return [];
    }
}

export function ChannelPicker({
    channels,
    platforms,
    selected,
    onChange,
}: Props) {
    const [pinsLoaded, setPinsLoaded] = useState(false);
    const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
    const groups = useMemo(() => {
        const next = new Map<
            string,
            { name: string; items: ChannelOption[] }
        >();
        for (const ch of channels) {
            const g = next.get(ch.platform) ?? {
                name: ch.platformName,
                items: [],
            };
            g.items.push(ch);
            next.set(ch.platform, g);
        }
        return next;
    }, [channels]);

    useEffect(() => {
        setPinnedKeys(readPinnedChannelKeys());
        setPinsLoaded(true);
    }, []);

    useEffect(() => {
        if (!pinsLoaded || typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                PINNED_CHANNELS_STORAGE_KEY,
                JSON.stringify(pinnedKeys),
            );
        } catch {
            // Pinning is a local convenience; publishing must keep working.
        }
    }, [pinnedKeys, pinsLoaded]);

    if (!channels.length) {
        return (
            <p className="muted">
                No resources configured. Open Resources and add a channel.
            </p>
        );
    }

    const selectedKeys = new Set(selected.map(key));
    const channelByKey = new Map(
        channels.map((ch) => [
            key({ platform: ch.platform, channelId: ch.id }),
            ch,
        ]),
    );
    const pinnedKeySet = new Set(pinnedKeys);
    const pinnedChannels = pinnedKeys
        .map((pinnedKey) => channelByKey.get(pinnedKey))
        .filter((ch): ch is ChannelOption => Boolean(ch));

    function toggle(platform: string, channelId: string) {
        const k = key({ platform, channelId });
        if (selectedKeys.has(k)) {
            onChange(selected.filter((t) => key(t) !== k));
        } else {
            onChange([...selected, { platform, channelId }]);
        }
    }

    function togglePinned(channel: ChannelOption) {
        const channelKey = key({
            platform: channel.platform,
            channelId: channel.id,
        });
        setPinnedKeys((current) =>
            current.includes(channelKey)
                ? current.filter((item) => item !== channelKey)
                : [channelKey, ...current],
        );
    }

    function toggleAll(items: ChannelOption[]) {
        const allOn = items.every((ch) =>
            selectedKeys.has(key({ platform: ch.platform, channelId: ch.id })),
        );
        const itemKeys = new Set(
            items.map((ch) => key({ platform: ch.platform, channelId: ch.id })),
        );
        if (allOn) {
            onChange(selected.filter((t) => !itemKeys.has(key(t))));
        } else {
            const additions = items
                .filter(
                    (ch) =>
                        !selectedKeys.has(
                            key({ platform: ch.platform, channelId: ch.id }),
                        ),
                )
                .map((ch) => ({ platform: ch.platform, channelId: ch.id }));
            onChange([...selected, ...additions]);
        }
    }

    function renderChannel(channel: ChannelOption) {
        const channelKey = key({
            platform: channel.platform,
            channelId: channel.id,
        });
        const checked = selectedKeys.has(channelKey);
        const pinned = pinnedKeySet.has(channelKey);
        const PinIcon = pinned ? PinOff : Pin;

        return (
            <div
                key={channelKey}
                className={`chip channel-chip ${checked ? 'selected' : ''}`}
            >
                <label className="chip-check">
                    <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(channel.platform, channel.id)}
                    />
                    <span>{channel.name}</span>
                </label>
                <button
                    type="button"
                    className="chip-pin"
                    title={pinned ? 'Unpin channel' : 'Pin channel'}
                    aria-label={`${pinned ? 'Unpin' : 'Pin'} ${channel.name}`}
                    onClick={() => togglePinned(channel)}
                >
                    <PinIcon size={14} strokeWidth={2.4} />
                </button>
            </div>
        );
    }

    return (
        <div className="channels">
            {pinnedChannels.length > 0 && (
                <div className="chan-group pinned-channels">
                    <div className="chan-group-head">
                        <span className="chan-plat">Pinned</span>
                    </div>
                    <div className="chan-items">
                        {pinnedChannels.map(renderChannel)}
                    </div>
                </div>
            )}
            {[...groups.entries()].map(([platform, group]) => {
                const visibleItems = group.items.filter(
                    (ch) =>
                        !pinnedKeySet.has(
                            key({
                                platform: ch.platform,
                                channelId: ch.id,
                            }),
                        ),
                );
                if (!visibleItems.length) return null;

                return (
                    <div className="chan-group" key={platform}>
                        <div className="chan-group-head">
                            <span className="chan-plat">
                                {platformIcon(platform, platforms)} {group.name}
                            </span>
                            <button
                                className="chan-all btn small"
                                onClick={() => toggleAll(group.items)}
                            >
                                All
                            </button>
                        </div>
                        <div className="chan-items">
                            {visibleItems.map(renderChannel)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
