import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useToast } from '../../toast';
import type { DraftFolder } from '../../../../shared/types';

const COLLAPSED_STORAGE_KEY = 'composer:draftFolderCollapsed';

function readCollapsed(): Record<string, true> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const next: Record<string, true> = {};
        for (const key of Object.keys(parsed)) {
            if (parsed[key] === true) next[key] = true;
        }
        return next;
    } catch {
        return {};
    }
}

/** A folder and every folder nested inside it, however deep — mirrors the
 * cascade the server performs on delete. */
function collectWithDescendants(all: DraftFolder[], rootId: string): Set<string> {
    const childrenOf = new Map<string, string[]>();
    for (const f of all) {
        if (!f.parentId) continue;
        const list = childrenOf.get(f.parentId) ?? [];
        list.push(f.id);
        childrenOf.set(f.parentId, list);
    }
    const ids = new Set([rootId]);
    for (const id of ids) {
        for (const childId of childrenOf.get(id) ?? []) ids.add(childId);
    }
    return ids;
}

/** Server-backed folders (shared across devices, like the drafts themselves);
 * only the collapsed state is a local convenience kept in localStorage. */
export function useDraftFolders() {
    const toast = useToast();
    const [folders, setFolders] = useState<DraftFolder[]>([]);
    const [collapsed, setCollapsed] =
        useState<Record<string, true>>(readCollapsed);

    const loadFolders = useCallback(async () => {
        try {
            const { folders } = await api<{ folders: DraftFolder[] }>(
                '/api/draft-folders',
            );
            setFolders(folders);
        } catch {
            // Folders are a convenience; the drafts list must keep working.
        }
    }, []);

    useEffect(() => {
        loadFolders();
    }, [loadFolders]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                COLLAPSED_STORAGE_KEY,
                JSON.stringify(collapsed),
            );
        } catch {
            // Collapsed state is a local convenience only.
        }
    }, [collapsed]);

    async function createFolder(): Promise<string | null> {
        try {
            const { folder } = await api<{ folder: DraftFolder }>(
                '/api/draft-folders',
                { method: 'POST', body: { name: 'New folder' } },
            );
            setFolders((cur) => [...cur, folder]);
            return folder.id;
        } catch (err: any) {
            toast(err.message, 'error');
            return null;
        }
    }

    async function renameFolder(folderId: string, name: string) {
        const trimmed = name.trim();
        if (!trimmed) return;
        setFolders((cur) =>
            cur.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)),
        );
        try {
            await api(`/api/draft-folders/${folderId}`, {
                method: 'PUT',
                body: { name: trimmed },
            });
        } catch (err: any) {
            toast(err.message, 'error');
            loadFolders();
        }
    }

    async function moveFolder(folderId: string, parentId: string | null) {
        setFolders((cur) =>
            cur.map((f) => (f.id === folderId ? { ...f, parentId } : f)),
        );
        try {
            await api(`/api/draft-folders/${folderId}`, {
                method: 'PUT',
                body: { parentId },
            });
        } catch (err: any) {
            toast(err.message, 'error');
            loadFolders();
        }
    }

    /** Deletes the folder and, like the server, every folder nested inside
     * it. Returns the full set of removed ids (folder + descendants) so
     * callers can drop drafts belonging to any of them, or null on failure. */
    async function deleteFolder(folderId: string): Promise<Set<string> | null> {
        const affected = collectWithDescendants(folders, folderId);
        setFolders((cur) => cur.filter((f) => !affected.has(f.id)));
        try {
            await api(`/api/draft-folders/${folderId}`, { method: 'DELETE' });
            return affected;
        } catch (err: any) {
            toast(err.message, 'error');
            loadFolders();
            return null;
        }
    }

    function toggleCollapsed(folderId: string) {
        setCollapsed((prev) => {
            const next = { ...prev };
            if (next[folderId]) delete next[folderId];
            else next[folderId] = true;
            return next;
        });
    }

    return {
        folders,
        createFolder,
        renameFolder,
        moveFolder,
        deleteFolder,
        collapsed,
        toggleCollapsed,
    };
}
