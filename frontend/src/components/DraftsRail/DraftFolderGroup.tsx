import { useState, type ReactNode } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    Pencil,
    Trash2,
} from 'lucide-react';
import type { DraftFolder } from '../../../../shared/types';
import styles from './DraftsRail.module.scss';

interface Props {
    folder: DraftFolder;
    count: number;
    collapsed: boolean;
    renaming: boolean;
    dragActive: boolean;
    onRename: (folderId: string, name: string) => void;
    onRenameStart: (folderId: string) => void;
    onRenameEnd: () => void;
    onDelete: (folderId: string) => void;
    onToggleCollapsed: (folderId: string) => void;
    /** Something (a draft or another folder) was dropped on this folder. */
    onDrop: (folderId: string) => void;
    onDragStartFolder: (folderId: string) => void;
    onDragEndFolder: () => void;
    children: ReactNode;
}

export function DraftFolderGroup({
    folder,
    count,
    collapsed,
    renaming,
    dragActive,
    onRename,
    onRenameStart,
    onRenameEnd,
    onDelete,
    onToggleCollapsed,
    onDrop,
    onDragStartFolder,
    onDragEndFolder,
    children,
}: Props) {
    const [dragOver, setDragOver] = useState(false);
    const Chevron = collapsed ? ChevronRight : ChevronDown;
    const FolderIcon = collapsed ? Folder : FolderOpen;

    function commitRename(value: string) {
        onRename(folder.id, value);
        onRenameEnd();
    }

    function remove() {
        const confirmed = window.confirm(
            `Delete folder "${folder.name}"? Drafts move back to the list.`,
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
                onDrop(folder.id);
            }}
        >
            <div
                className={styles.groupHead}
                draggable={!renaming}
                onDragStart={(e) => {
                    e.dataTransfer?.setData('text/plain', folder.id);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                    onDragStartFolder(folder.id);
                }}
                onDragEnd={onDragEndFolder}
            >
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
                        aria-label={`${collapsed ? 'Expand' : 'Collapse'} folder ${folder.name}`}
                        onClick={() => onToggleCollapsed(folder.id)}
                    >
                        <Chevron size={14} strokeWidth={2.4} />
                        <FolderIcon size={14} strokeWidth={2.4} />
                        <span className={styles.folderName}>{folder.name}</span>
                        <span className={styles.count}>{count}</span>
                    </button>
                )}
                <div className={styles.headActions}>
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
            {!collapsed && <div className={styles.children}>{children}</div>}
        </section>
    );
}
