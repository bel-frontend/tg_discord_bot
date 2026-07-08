import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelPicker } from './ChannelPicker';
import type { ChannelOption, PlatformMeta } from '../../../shared/types';

const channels: ChannelOption[] = [
    {
        platform: 'discord',
        platformName: 'Discord',
        id: 'dumplings',
        name: 'Quantum draniki',
    },
    {
        platform: 'telegram',
        platformName: 'Telegram',
        id: '@krasny_bagatyr',
        name: '@krasny_bagatyr',
    },
];

const platforms: PlatformMeta[] = [
    { id: 'discord', name: 'Discord' },
    { id: 'telegram', name: 'Telegram' },
];

describe('ChannelPicker', () => {
    beforeEach(() => {
        const store = new Map<string, string>();
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: vi.fn((item: string) => store.get(item) ?? null),
                setItem: vi.fn((item: string, value: string) => {
                    store.set(item, value);
                }),
            },
        });
    });

    it('pins channels to the top and persists the choice', async () => {
        const onChange = vi.fn();

        render(
            <ChannelPicker
                channels={channels}
                platforms={platforms}
                selected={[]}
                onChange={onChange}
            />,
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Pin @krasny_bagatyr' }),
        );

        expect(screen.getByText('Pinned')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Unpin @krasny_bagatyr' }),
        ).toBeInTheDocument();

        await waitFor(() => {
            expect(
                JSON.parse(
                    window.localStorage.getItem('composer:pinnedChannels') ??
                        '[]',
                ),
            ).toEqual(['telegram:@krasny_bagatyr']);
        });
    });
});
