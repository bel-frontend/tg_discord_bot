import { useEffect, useState } from 'react';

const PINNED_CHANNELS_STORAGE_KEY = 'composer:pinnedChannels';

function readPinnedChannelKeys(): string[] {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(PINNED_CHANNELS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : [];
    } catch {
        return [];
    }
}

export function usePinnedChannels() {
    const [loaded, setLoaded] = useState(false);
    const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);

    useEffect(() => {
        setPinnedKeys(readPinnedChannelKeys());
        setLoaded(true);
    }, []);

    useEffect(() => {
        if (!loaded || typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                PINNED_CHANNELS_STORAGE_KEY,
                JSON.stringify(pinnedKeys),
            );
        } catch {
            // Pinning is a local convenience; publishing must keep working.
        }
    }, [pinnedKeys, loaded]);

    function togglePinned(key: string) {
        setPinnedKeys((current) =>
            current.includes(key)
                ? current.filter((item) => item !== key)
                : [key, ...current],
        );
    }

    return { pinnedKeys, togglePinned };
}
