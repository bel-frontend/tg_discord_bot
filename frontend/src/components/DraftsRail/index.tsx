import { useState } from 'react';
import { FolderPlus, Pin } from 'lucide-react';
import type { Draft, DraftFolder } from '../../../../shared/types';
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
    /** Lets the drafts owner drop stale folderId refs without a refetch —
     * includes the deleted folder plus every subfolder cascaded with it. */
    onFolderDeleted?: (folderIds: Set<string>) => void;
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
        moveFolder,
        deleteFolder,
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

    /** True when `candidateId` is nested (at any depth) inside `ancestorId` —
     * used to block dropping a folder onto its own descendant. */
    function isDescendant(candidateId: string, ancestorId: string): boolean {
        let current = folders.find((f) => f.id === candidateId);
        while (current?.parentId) {
            if (current.parentId === ancestorId) return true;
            current = folders.find((f) => f.id === current!.parentId);
        }
        return false;
    }

    function dropOnFolder(folderId: string) {
        if (dragDraftId) {
            onMove(dragDraftId, folderId);
        } else if (
            dragFolderId &&
            dragFolderId !== folderId &&
            !isDescendant(folderId, dragFolderId)
        ) {
            moveFolder(dragFolderId, folderId);
        }
        endDrag();
    }

    function dropOnRoot() {
        if (dragDraftId) {
            onMove(dragDraftId, null);
        } else if (dragFolderId) {
            moveFolder(dragFolderId, null);
        }
        endDrag();
    }

    async function removeFolder(folderId: string) {
        const affected = await deleteFolder(folderId);
        if (affected) {
            setSelectedFolderId((cur) => (cur && affected.has(cur) ? null : cur));
            onFolderDeleted?.(affected);
        }
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

    function childrenOf(parentId: string | null) {
        return folders.filter((f) => (f.parentId ?? null) === parentId);
    }

    /** Drafts inside this folder and every subfolder nested inside it —
     * matches the server's delete cascade, for an accurate confirm prompt. */
    function draftCountIncludingDescendants(folderId: string): number {
        let total = drafts.filter((d) => d.folderId === folderId).length;
        for (const child of childrenOf(folderId)) {
            total += draftCountIncludingDescendants(child.id);
        }
        return total;
    }

    function renderFolder(folder: DraftFolder) {
        const members = drafts.filter((d) => d.folderId === folder.id);
        const visibleMembers = members.filter((d) => !d.pinned);
        const childFolders = childrenOf(folder.id);

        return (
            <DraftFolderGroup
                key={folder.id}
                folder={folder}
                count={members.length}
                deleteImpactCount={draftCountIncludingDescendants(folder.id)}
                collapsed={Boolean(collapsed[folder.id])}
                selected={selectedFolderId === folder.id}
                renaming={renamingFolderId === folder.id}
                dragActive={dragDraftId !== null || dragFolderId !== null}
                onRename={renameFolder}
                onRenameStart={setRenamingFolderId}
                onRenameEnd={() => setRenamingFolderId(null)}
                onDelete={removeFolder}
                onToggleCollapsed={toggleCollapsed}
                onSelect={(id) =>
                    setSelectedFolderId((cur) => (cur === id ? null : id))
                }
                onDrop={dropOnFolder}
                onDragStartFolder={setDragFolderId}
                onDragEndFolder={endDrag}
            >
                {childFolders.map(renderFolder)}
                {visibleMembers.length || childFolders.length ? (
                    visibleMembers.map(renderRow)
                ) : (
                    <p className={styles.dropHint}>Drag drafts here</p>
                )}
            </DraftFolderGroup>
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
                    // Dropping outside a folder moves the dragged draft or
                    // folder back to the root — like dragging a file out of
                    // a directory.
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
                {childrenOf(null).map(renderFolder)}
                {rootDrafts.map(renderRow)}
            </div>
        </aside>
    );
}
