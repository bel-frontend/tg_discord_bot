import { useCallback, useState } from 'react';
import { fetchPlatforms } from '../api';
import type { PlatformMeta } from '../../../shared/types';

/** Loads and holds the registered-platform metadata (icon, name, char limit). */
export function usePlatforms() {
    const [platforms, setPlatforms] = useState<PlatformMeta[]>([]);

    const loadPlatforms = useCallback(async () => {
        setPlatforms(await fetchPlatforms());
    }, []);

    return { platforms, loadPlatforms };
}
