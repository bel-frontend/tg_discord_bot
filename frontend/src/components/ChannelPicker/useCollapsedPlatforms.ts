import { useEffect, useState } from 'react';

const COLLAPSED_PLATFORMS_STORAGE_KEY =
    'composer:collapsedChannelPlatforms';

function readCollapsedPlatforms(): Set<string> {
    if (typeof window === 'undefined') return new Set();

    try {
        const raw = window.localStorage.getItem(
            COLLAPSED_PLATFORMS_STORAGE_KEY,
        );
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return new Set();
        return new Set(
            parsed.filter((id): id is string => typeof id === 'string'),
        );
    } catch {
        return new Set();
    }
}

export function useCollapsedPlatforms() {
    const [loaded, setLoaded] = useState(false);
    const [collapsedPlatforms, setCollapsedPlatforms] = useState<Set<string>>(
        new Set(),
    );

    useEffect(() => {
        setCollapsedPlatforms(readCollapsedPlatforms());
        setLoaded(true);
    }, []);

    useEffect(() => {
        if (!loaded || typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(
                COLLAPSED_PLATFORMS_STORAGE_KEY,
                JSON.stringify([...collapsedPlatforms]),
            );
        } catch {
            // Collapsing is a local convenience; publishing must keep working.
        }
    }, [collapsedPlatforms, loaded]);

    function togglePlatformCollapsed(platform: string) {
        setCollapsedPlatforms((current) => {
            const next = new Set(current);
            if (next.has(platform)) next.delete(platform);
            else next.add(platform);
            return next;
        });
    }

    return { collapsedPlatforms, togglePlatformCollapsed };
}
