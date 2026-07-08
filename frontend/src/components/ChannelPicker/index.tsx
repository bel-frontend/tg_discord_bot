import { useMemo, useState } from 'react';
import { FolderPlus, Pin } from 'lucide-react';
import type {
    ChannelOption,
    PlatformMeta,
    Target,
} from '../../../../shared/types';
import { channelOptionKey, channelKey } from './channelKey';
import { usePinnedChannels } from './usePinnedChannels';
import { useChannelFolders } from './useChannelFolders';
import { ChannelRow } from './ChannelRow';
import { FolderGroup } from './FolderGroup';
import styles from './ChannelPicker.module.scss';

export function platformIcon(id: string, platforms: PlatformMeta[]): string {
    return platforms.find((p) => p.id === id)?.icon ?? '🌐';
}

interface Props {
    channels: ChannelOption[];
    platforms: PlatformMeta[];
    selected: Target[];
    onChange: (next: Target[]) => void;
}

export function ChannelPicker({
    channels,
    platforms,
    selected,
    onChange,
}: Props) {
    const { pinnedKeys, togglePinned } = usePinnedChannels();
    const {
        folders,
        createFolder,
        renameFolder,
        deleteFolder,
        moveToFolder,
        toggleCollapsed,
    } = useChannelFolders();
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(
        null,
    );
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

    if (!channels.length) {
        return (
            <p className="muted">
                No resources configured. Open Resources and add a channel.
            </p>
        );
    }

    const selectedKeys = new Set(selected.map(channelKey));
    const channelByKey = new Map(
        channels.map((ch) => [channelOptionKey(ch), ch]),
    );
    const pinnedKeySet = new Set(pinnedKeys);
    const pinnedChannels = pinnedKeys
        .map((pinnedKey) => channelByKey.get(pinnedKey))
        .filter((ch): ch is ChannelOption => Boolean(ch));
    const folderedKeySet = new Set(folders.flatMap((f) => f.channelKeys));

    function toggle(channel: ChannelOption) {
        const k = channelOptionKey(channel);
        if (selectedKeys.has(k)) {
            onChange(selected.filter((t) => channelKey(t) !== k));
        } else {
            onChange([
                ...selected,
                { platform: channel.platform, channelId: channel.id },
            ]);
        }
    }

    function toggleAll(items: ChannelOption[]) {
        const allOn = items.every((ch) =>
            selectedKeys.has(channelOptionKey(ch)),
        );
        const itemKeys = new Set(items.map(channelOptionKey));
        if (allOn) {
            onChange(selected.filter((t) => !itemKeys.has(channelKey(t))));
        } else {
            const additions = items
                .filter((ch) => !selectedKeys.has(channelOptionKey(ch)))
                .map((ch) => ({ platform: ch.platform, channelId: ch.id }));
            onChange([...selected, ...additions]);
        }
    }

    function newFolder() {
        const id = createFolder('New folder');
        if (id) setRenamingFolderId(id);
    }

    function dropOnFolder(folderId: string | null) {
        if (dragKey) moveToFolder(dragKey, folderId);
        setDragKey(null);
    }

    function renderRow(channel: ChannelOption) {
        const key = channelOptionKey(channel);
        return (
            <ChannelRow
                key={key}
                channel={channel}
                icon={platformIcon(channel.platform, platforms)}
                checked={selectedKeys.has(key)}
                pinned={pinnedKeySet.has(key)}
                dragging={dragKey === key}
                onToggleSelect={toggle}
                onTogglePinned={togglePinned}
                onDragStart={setDragKey}
                onDragEnd={() => setDragKey(null)}
            />
        );
    }

    return (
        <div
            className={`channels ${styles.tree}`}
            onDragOver={(e) => {
                // Dropping anywhere outside a folder removes the channel from
                // its folder — like dragging a file back to the root.
                if (dragKey) e.preventDefault();
            }}
            onDrop={(e) => {
                e.preventDefault();
                dropOnFolder(null);
            }}
        >
            <div>
                <button
                    type="button"
                    className={`btn small ${styles.newFolderBtn}`}
                    onClick={newFolder}
                >
                    <FolderPlus size={14} strokeWidth={2.4} />
                    New folder
                </button>
            </div>
            {pinnedChannels.length > 0 && (
                <section className={styles.group}>
                    <div className={styles.groupHead}>
                        <span className={styles.groupTitle}>
                            <Pin size={14} strokeWidth={2.4} />
                            Pinned
                        </span>
                    </div>
                    <div className={styles.children}>
                        {pinnedChannels.map(renderRow)}
                    </div>
                </section>
            )}
            {folders.map((folder) => {
                const memberChannels = folder.channelKeys
                    .map((k) => channelByKey.get(k))
                    .filter((ch): ch is ChannelOption => Boolean(ch));
                const visibleMembers = memberChannels.filter(
                    (ch) => !pinnedKeySet.has(channelOptionKey(ch)),
                );

                return (
                    <FolderGroup
                        key={folder.id}
                        folder={folder}
                        memberCount={memberChannels.length}
                        renaming={renamingFolderId === folder.id}
                        dragActive={dragKey !== null}
                        onToggleAll={() => toggleAll(memberChannels)}
                        onRename={renameFolder}
                        onRenameStart={setRenamingFolderId}
                        onRenameEnd={() => setRenamingFolderId(null)}
                        onDelete={deleteFolder}
                        onToggleCollapsed={toggleCollapsed}
                        onDropChannel={dropOnFolder}
                    >
                        {visibleMembers.length ? (
                            visibleMembers.map(renderRow)
                        ) : (
                            <p className={styles.dropHint}>
                                Drag channels here
                            </p>
                        )}
                    </FolderGroup>
                );
            })}
            {[...groups.entries()].map(([platform, group]) => {
                const visibleItems = group.items.filter((ch) => {
                    const k = channelOptionKey(ch);
                    return !pinnedKeySet.has(k) && !folderedKeySet.has(k);
                });
                if (!visibleItems.length) return null;

                return (
                    <section className={styles.group} key={platform}>
                        <div className={styles.groupHead}>
                            <span className={styles.groupTitle}>
                                {platformIcon(platform, platforms)} {group.name}
                            </span>
                            <button
                                className="chan-all btn small"
                                onClick={() => toggleAll(group.items)}
                            >
                                All
                            </button>
                        </div>
                        <div className={styles.children}>
                            {visibleItems.map(renderRow)}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}
