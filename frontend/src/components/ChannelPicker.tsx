import type { ChannelOption, Target } from '../types';

export function platformIcon(id: string): string {
    if (id === 'telegram') return '✈️';
    if (id === 'discord') return '🎮';
    return '🌐';
}

function key(t: { platform: string; channelId: string }): string {
    return `${t.platform}:${t.channelId}`;
}

interface Props {
    channels: ChannelOption[];
    selected: Target[];
    onChange: (next: Target[]) => void;
}

export function ChannelPicker({ channels, selected, onChange }: Props) {
    if (!channels.length) {
        return (
            <p className="muted">
                No resources configured. Open Resources and add a channel.
            </p>
        );
    }

    const selectedKeys = new Set(selected.map(key));

    const groups = new Map<
        string,
        { name: string; items: ChannelOption[] }
    >();
    for (const ch of channels) {
        const g = groups.get(ch.platform) ?? {
            name: ch.platformName,
            items: [],
        };
        g.items.push(ch);
        groups.set(ch.platform, g);
    }

    function toggle(platform: string, channelId: string) {
        const k = key({ platform, channelId });
        if (selectedKeys.has(k)) {
            onChange(
                selected.filter((t) => key(t) !== k),
            );
        } else {
            onChange([...selected, { platform, channelId }]);
        }
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

    return (
        <div className="channels">
            {[...groups.entries()].map(([platform, group]) => (
                <div className="chan-group" key={platform}>
                    <div className="chan-group-head">
                        <span className="chan-plat">
                            {platformIcon(platform)} {group.name}
                        </span>
                        <button
                            className="chan-all btn small"
                            onClick={() => toggleAll(group.items)}
                        >
                            All
                        </button>
                    </div>
                    <div className="chan-items">
                        {group.items.map((ch) => {
                            const checked = selectedKeys.has(
                                key({
                                    platform: ch.platform,
                                    channelId: ch.id,
                                }),
                            );
                            return (
                                <label
                                    key={ch.id}
                                    className={`chip ${
                                        checked ? 'selected' : ''
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                            toggle(ch.platform, ch.id)
                                        }
                                    />
                                    <span>{ch.name}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}
