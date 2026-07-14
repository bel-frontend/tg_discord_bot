import { useState } from 'react';
import { FolderPlus, Pin } from 'lucide-react';
import type { Draft } from '../../../../shared/types';
import { useDraftFolders } from './useDraftFolders';
import { DraftRow } from './DraftRow';
import { DraftFolderGroup } from './DraftFolderGroup';
import styles from './DraftsRail.module.scss';

interface Props {
    drafts: Draft[];
    activeId: string | null;
    onNew: (folderId: string | null) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onMove: (id: string, folderId: string | null) => void;
    onTogglePin: (id: string) => void;
    /** Lets the drafts owner drop stale folderId refs without a refetch. */
    onFolderDeleted?: (folderId: string) => void;
}

export function DraftsRail({
    drafts,
    activeId,
    onNew,
    onOpen,
    onDelete,
    onRename,
    onMove,
    onTogglePin,
    onFolderDeleted,
}: Props) {
    const {
        folders,
        createFolder,
        renameFolder,
        deleteFolder,
        reorderFolders,
        collapsed,
        toggleCollapsed,
    } = useDraftFolders();
    const [dragDraftId, setDragDraftId] = useState<string | null>(null);
    const [dragFolderId, setDragFolderId] = useState<string | null>(null);
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(
        null,
    );
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(
        null,
    );
    const [renamingDraftId, setRenamingDraftId] = useState<string | null>(
        null,
    );

    // Drafts arrive sorted updatedAt desc from the server — only filter here.
    const folderIds = new Set(folders.map((f) => f.id));
    const pinnedDrafts = drafts.filter((d) => d.pinned);
    const rootDrafts = drafts.filter(
        (d) =>
            !d.pinned && (!d.folderId || !folderIds.has(d.folderId)),
    );

    async function newFolder() {
        const id = await createFolder();
        if (id) setRenamingFolderId(id);
    }

    function endDrag() {
        setDragDraftId(null);
        setDragFolderId(null);
    }

    function dropOnFolder(folderId: string) {
        if (dragDraftId) {
            onMove(dragDraftId, folderId);
        } else if (dragFolderId && dragFolderId !== folderId) {
            const ids = folders
                .map((f) => f.id)
                .filter((id) => id !== dragFolderId);
            ids.splice(ids.indexOf(folderId), 0, dragFolderId);
            reorderFolders(ids);
        }
        endDrag();
    }

    function dropOnRoot() {
        if (dragDraftId) {
            onMove(dragDraftId, null);
        } else if (dragFolderId) {
            const ids = folders
                .map((f) => f.id)
                .filter((id) => id !== dragFolderId);
            ids.push(dragFolderId);
            reorderFolders(ids);
        }
        endDrag();
    }

    async function removeFolder(folderId: string) {
        setSelectedFolderId((cur) => (cur === folderId ? null : cur));
        const ok = await deleteFolder(folderId);
        if (ok) onFolderDeleted?.(folderId);
    }

    function renderRow(draft: Draft) {
        return (
            <DraftRow
                key={draft.id}
                draft={draft}
                active={draft.id === activeId}
                dragging={dragDraftId === draft.id}
                renaming={renamingDraftId === draft.id}
                onOpen={onOpen}
                onDelete={onDelete}
                onRename={onRename}
                onRenameStart={setRenamingDraftId}
                onRenameEnd={() => setRenamingDraftId(null)}
                onTogglePin={onTogglePin}
                onDragStart={setDragDraftId}
                onDragEnd={endDrag}
            />
        );
    }

    return (
        <aside className="rail">
            <div className="rail-head">
                <span>Drafts</span>
                <div className={styles.headActions}>
                    <button
                        type="button"
                        className={styles.iconBtn}
                        title="New folder"
                        aria-label="New folder"
                        onClick={newFolder}
                    >
                        <FolderPlus size={16} strokeWidth={2.4} />
                    </button>
                    <button
                        className="btn small"
                        onClick={() => onNew(selectedFolderId)}
                    >
                        ＋ New
                    </button>
                </div>
            </div>
            <div
                className={styles.list}
                onDragOver={(e) => {
                    // Dropping outside a folder moves the draft back to the
                    // root — like dragging a file out of a directory — or,
                    // for a dragged folder, reorders it to the end.
                    if (dragDraftId || dragFolderId) e.preventDefault();
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    dropOnRoot();
                }}
                onClick={(e) => {
                    // Only deselect when the background itself was clicked,
                    // not a bubbled click from a folder/draft row inside it.
                    if (e.target === e.currentTarget) {
                        setSelectedFolderId(null);
                    }
                }}
            >
                {drafts.length === 0 && folders.length === 0 && (
                    <p className={styles.empty}>No drafts yet</p>
                )}
                {pinnedDrafts.length > 0 && (
                    <section className={styles.group}>
                        <div className={styles.groupHead}>
                            <span className={styles.groupTitle}>
                                <Pin size={14} strokeWidth={2.4} />
                                Pinned
                            </span>
                        </div>
                        <div className={styles.children}>
                            {pinnedDrafts.map(renderRow)}
                        </div>
                    </section>
                )}
                {folders.map((folder) => {
                    const members = drafts.filter(
                        (d) => d.folderId === folder.id,
                    );
                    const visibleMembers = members.filter((d) => !d.pinned);

                    return (
                        <DraftFolderGroup
                            key={folder.id}
                            folder={folder}
                            count={members.length}
                            collapsed={Boolean(collapsed[folder.id])}
                            selected={selectedFolderId === folder.id}
                            renaming={renamingFolderId === folder.id}
                            dragActive={
                                dragDraftId !== null || dragFolderId !== null
                            }
                            onRename={renameFolder}
                            onRenameStart={setRenamingFolderId}
                            onRenameEnd={() => setRenamingFolderId(null)}
                            onDelete={removeFolder}
                            onToggleCollapsed={toggleCollapsed}
                            onSelect={(id) =>
                                setSelectedFolderId((cur) =>
                                    cur === id ? null : id,
                                )
                            }
                            onDrop={dropOnFolder}
                            onDragStartFolder={setDragFolderId}
                            onDragEndFolder={endDrag}
                        >
                            {visibleMembers.length ? (
                                visibleMembers.map(renderRow)
                            ) : (
                                <p className={styles.dropHint}>
                                    Drag drafts here
                                </p>
                            )}
                        </DraftFolderGroup>
                    );
                })}
                {rootDrafts.map(renderRow)}
            </div>
        </aside>
    );
}
