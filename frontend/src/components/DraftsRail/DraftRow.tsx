import { GripVertical, Pencil, Pin, PinOff, X } from 'lucide-react';
import type { Draft } from '../../../../shared/types';
import styles from './DraftsRail.module.scss';

interface Props {
    draft: Draft;
    active: boolean;
    dragging: boolean;
    renaming: boolean;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onRenameStart: (id: string) => void;
    onRenameEnd: () => void;
    onTogglePin: (id: string) => void;
    onDragStart: (id: string) => void;
    onDragEnd: () => void;
}

export function DraftRow({
    draft,
    active,
    dragging,
    renaming,
    onOpen,
    onDelete,
    onRename,
    onRenameStart,
    onRenameEnd,
    onTogglePin,
    onDragStart,
    onDragEnd,
}: Props) {
    const PinIcon = draft.pinned ? PinOff : Pin;

    function commitRename(value: string) {
        onRename(draft.id, value);
        onRenameEnd();
    }

    return (
        <div
            className={`${styles.row} ${active ? styles.rowActive : ''} ${dragging ? styles.dragging : ''}`}
            draggable={!renaming}
            onDragStart={(e) => {
                e.dataTransfer?.setData('text/plain', draft.id);
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                onDragStart(draft.id);
            }}
            onDragEnd={onDragEnd}
        >
            <GripVertical size={12} className={styles.grip} />
            {renaming ? (
                <input
                    className={styles.renameInput}
                    autoFocus
                    defaultValue={draft.title}
                    aria-label="Draft title"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') onRenameEnd();
                    }}
                    onBlur={(e) => commitRename(e.currentTarget.value)}
                />
            ) : (
                <button
                    type="button"
                    className={styles.rowOpen}
                    onClick={() => onOpen(draft.id)}
                >
                    <span className={styles.rowTitle}>{draft.title}</span>
                    <span className={styles.rowTime}>
                        {new Date(draft.updatedAt).toLocaleString()}
                    </span>
                </button>
            )}
            <div className={styles.rowActions}>
                <button
                    type="button"
                    className={styles.iconBtn}
                    title={draft.pinned ? 'Unpin draft' : 'Pin draft'}
                    aria-label={`${draft.pinned ? 'Unpin' : 'Pin'} ${draft.title}`}
                    onClick={() => onTogglePin(draft.id)}
                >
                    <PinIcon size={14} strokeWidth={2.4} />
                </button>
                <button
                    type="button"
                    className={styles.iconBtn}
                    title="Rename draft"
                    aria-label={`Rename ${draft.title}`}
                    onClick={() => onRenameStart(draft.id)}
                >
                    <Pencil size={14} strokeWidth={2.4} />
                </button>
                <button
                    type="button"
                    className={`${styles.iconBtn} ${styles.dangerBtn}`}
                    title="Delete draft"
                    aria-label={`Delete ${draft.title}`}
                    onClick={() => onDelete(draft.id)}
                >
                    <X size={14} strokeWidth={2.4} />
                </button>
            </div>
        </div>
    );
}
