import { useCallback, useState } from 'react';
import { api } from '../api';
import type { ChannelOption } from '../../../shared/types';

/** Loads and holds the publish-target channel list. Shared by Composer and ResourceManager. */
export function useChannels() {
    const [channels, setChannels] = useState<ChannelOption[]>([]);

    const loadChannels = useCallback(async () => {
        const { channels } = await api<{ channels: ChannelOption[] }>(
            '/api/channels',
        );
        setChannels(channels);
    }, []);

    return { channels, loadChannels };
}
