import { useEffect, useState } from 'react';

const CHANNEL_FOLDERS_STORAGE_KEY = 'composer:channelFolders';

export interface ChannelFolder {
    id: string;
    name: string;
    channelKeys: string[];
    collapsed?: boolean;
}

function readChannelFolders(): ChannelFolder[] {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(CHANNEL_FOLDERS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(
                (item) =>
                    item &&
                    typeof item === 'object' &&
                    typeof item.id === 'string' &&
                    typeof item.name === 'string' &&
                    Array.isArray(item.channelKeys),
            )
            .map((item) => ({
                id: item.id as string,
                name: item.name as string,
                channelKeys: (item.channelKeys as unknown[]).filter(
                    (k): k is string => typeof k === 'string',
                ),
                collapsed: item.collapsed === true,
            }));
    } catch {
        return [];
    }
}

export function useChannelFolders() {
    const [loaded, setLoaded] = useState(false);
    const [folders, setFolders] = useState<ChannelFolder[]>([]);

    useEffect(() => {
        setFolders(readChannelFolders());
        setLoaded(true);
    }, []);

    useEffect(() => {
        if (!loaded || typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                CHANNEL_FOLDERS_STORAGE_KEY,
                JSON.stringify(folders),
            );
        } catch {
            // Folders are a local convenience; publishing must keep working.
        }
    }, [folders, loaded]);

    function createFolder(name: string): string | null {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const id = crypto.randomUUID();
        setFolders((current) => [
            ...current,
            { id, name: trimmed, channelKeys: [] },
        ]);
        return id;
    }

    function renameFolder(folderId: string, name: string) {
        const trimmed = name.trim();
        if (!trimmed) return;
        setFolders((current) =>
            current.map((f) =>
                f.id === folderId ? { ...f, name: trimmed } : f,
            ),
        );
    }

    function deleteFolder(folderId: string) {
        setFolders((current) => current.filter((f) => f.id !== folderId));
    }

    // A channel belongs to at most one folder; null removes it from all.
    function moveToFolder(key: string, folderId: string | null) {
        setFolders((current) =>
            current.map((f) => {
                const channelKeys = f.channelKeys.filter((k) => k !== key);
                if (f.id === folderId) channelKeys.push(key);
                return { ...f, channelKeys };
            }),
        );
    }

    function toggleCollapsed(folderId: string) {
        setFolders((current) =>
            current.map((f) =>
                f.id === folderId ? { ...f, collapsed: !f.collapsed } : f,
            ),
        );
    }

    return {
        folders,
        createFolder,
        renameFolder,
        deleteFolder,
        moveToFolder,
        toggleCollapsed,
    };
}
