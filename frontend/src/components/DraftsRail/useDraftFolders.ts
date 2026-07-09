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

    async function deleteFolder(folderId: string) {
        setFolders((cur) => cur.filter((f) => f.id !== folderId));
        try {
            await api(`/api/draft-folders/${folderId}`, { method: 'DELETE' });
        } catch (err: any) {
            toast(err.message, 'error');
            loadFolders();
        }
    }

    async function reorderFolders(ids: string[]) {
        setFolders((cur) =>
            [...cur].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
        );
        try {
            await api('/api/draft-folders/order', {
                method: 'PUT',
                body: { ids },
            });
        } catch (err: any) {
            toast(err.message, 'error');
            loadFolders();
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
        deleteFolder,
        reorderFolders,
        collapsed,
        toggleCollapsed,
    };
}
