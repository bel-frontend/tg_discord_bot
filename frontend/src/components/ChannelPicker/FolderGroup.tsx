import { useState, type ReactNode } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    Pencil,
    Trash2,
} from 'lucide-react';
import type { ChannelFolder } from './useChannelFolders';
import styles from './ChannelPicker.module.scss';

interface Props {
    folder: ChannelFolder;
    memberCount: number;
    renaming: boolean;
    dragActive: boolean;
    onToggleAll: () => void;
    onRename: (folderId: string, name: string) => void;
    onRenameStart: (folderId: string) => void;
    onRenameEnd: () => void;
    onDelete: (folderId: string) => void;
    onToggleCollapsed: (folderId: string) => void;
    onDropChannel: (folderId: string) => void;
    children: ReactNode;
}

export function FolderGroup({
    folder,
    memberCount,
    renaming,
    dragActive,
    onToggleAll,
    onRename,
    onRenameStart,
    onRenameEnd,
    onDelete,
    onToggleCollapsed,
    onDropChannel,
    children,
}: Props) {
    const [dragOver, setDragOver] = useState(false);
    const Chevron = folder.collapsed ? ChevronRight : ChevronDown;
    const FolderIcon = folder.collapsed ? Folder : FolderOpen;

    function commitRename(value: string) {
        onRename(folder.id, value);
        onRenameEnd();
    }

    function remove() {
        const confirmed = window.confirm(
            `Delete folder "${folder.name}"? Channels stay available in their platform groups.`,
        );
        if (confirmed) onDelete(folder.id);
    }

    return (
        <section
            className={`${styles.group} ${dragOver ? styles.dropTarget : ''}`}
            onDragOver={(e) => {
                if (!dragActive) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                setDragOver(true);
            }}
            onDragLeave={(e) => {
                if (
                    e.relatedTarget instanceof Node &&
                    e.currentTarget.contains(e.relatedTarget)
                )
                    return;
                setDragOver(false);
            }}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOver(false);
                onDropChannel(folder.id);
            }}
        >
            <div className={styles.groupHead}>
                {renaming ? (
                    <input
                        className={styles.renameInput}
                        autoFocus
                        defaultValue={folder.name}
                        aria-label="Folder name"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') onRenameEnd();
                        }}
                        onBlur={(e) => commitRename(e.currentTarget.value)}
                    />
                ) : (
                    <button
                        type="button"
                        className={styles.folderToggle}
                        aria-label={`${folder.collapsed ? 'Expand' : 'Collapse'} folder ${folder.name}`}
                        onClick={() => onToggleCollapsed(folder.id)}
                    >
                        <Chevron size={14} strokeWidth={2.4} />
                        <FolderIcon size={14} strokeWidth={2.4} />
                        <span className={styles.folderName}>{folder.name}</span>
                        <span className={styles.count}>{memberCount}</span>
                    </button>
                )}
                <div className={styles.headActions}>
                    {memberCount > 0 && (
                        <button
                            className="chan-all btn small"
                            onClick={onToggleAll}
                        >
                            All
                        </button>
                    )}
                    <button
                        type="button"
                        className={styles.iconBtn}
                        title="Rename folder"
                        aria-label={`Rename folder ${folder.name}`}
                        onClick={() => onRenameStart(folder.id)}
                    >
                        <Pencil size={14} strokeWidth={2.4} />
                    </button>
                    <button
                        type="button"
                        className={styles.iconBtn}
                        title="Delete folder"
                        aria-label={`Delete folder ${folder.name}`}
                        onClick={remove}
                    >
                        <Trash2 size={14} strokeWidth={2.4} />
                    </button>
                </div>
            </div>
            {!folder.collapsed && (
                <div className={styles.children}>{children}</div>
            )}
        </section>
    );
}
