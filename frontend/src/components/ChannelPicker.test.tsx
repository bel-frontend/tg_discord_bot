import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function seedFolders(
    folders: Array<{
        id: string;
        name: string;
        channelKeys: string[];
        collapsed?: boolean;
    }>,
) {
    window.localStorage.setItem(
        'composer:channelFolders',
        JSON.stringify(folders),
    );
}

function storedFolders() {
    return JSON.parse(
        window.localStorage.getItem('composer:channelFolders') ?? '[]',
    );
}

function dragChannelTo(channelName: string, dropTarget: Element) {
    fireEvent.dragStart(screen.getByText(channelName));
    fireEvent.drop(dropTarget);
}

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

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renderPicker(onChange = vi.fn()) {
        render(
            <ChannelPicker
                channels={channels}
                platforms={platforms}
                selected={[]}
                onChange={onChange}
            />,
        );
        return onChange;
    }

    it('pins channels to the top and persists the choice', async () => {
        renderPicker();

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

    it('collapses platform groups, shows selection status, and persists it', async () => {
        render(
            <ChannelPicker
                channels={channels}
                platforms={platforms}
                selected={[
                    {
                        platform: 'telegram',
                        channelId: '@krasny_bagatyr',
                    },
                ]}
                onChange={vi.fn()}
            />,
        );

        fireEvent.click(
            screen.getByRole('button', {
                name: 'Collapse platform Telegram',
            }),
        );

        expect(screen.queryByText('@krasny_bagatyr')).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Expand platform Telegram' }),
        ).toBeInTheDocument();
        expect(screen.getByText('1/1')).toBeInTheDocument();

        await waitFor(() => {
            expect(
                JSON.parse(
                    window.localStorage.getItem(
                        'composer:collapsedChannelPlatforms',
                    ) ?? '[]',
                ),
            ).toEqual(['telegram']);
        });
    });

    it('creates a folder and lets the user name it inline', async () => {
        renderPicker();

        fireEvent.click(screen.getByRole('button', { name: /New folder/ }));

        const input = screen.getByRole('textbox', { name: 'Folder name' });
        fireEvent.change(input, { target: { value: 'Favourites' } });
        fireEvent.blur(input);

        expect(screen.getByText('Favourites')).toBeInTheDocument();

        await waitFor(() => {
            expect(storedFolders()).toEqual([
                expect.objectContaining({
                    id: expect.any(String),
                    name: 'Favourites',
                    channelKeys: [],
                }),
            ]);
        });
    });

    it('restores folders from localStorage on mount', () => {
        seedFolders([
            { id: 'f1', name: 'Favourites', channelKeys: ['discord:dumplings'] },
        ]);
        renderPicker();

        expect(screen.getByText('Favourites')).toBeInTheDocument();
        expect(screen.getByText('Quantum draniki')).toBeInTheDocument();
        expect(screen.queryByText(/Discord/)).not.toBeInTheDocument();
    });

    it('moves a channel into a folder via drag and drop', async () => {
        seedFolders([{ id: 'f1', name: 'Favourites', channelKeys: [] }]);
        renderPicker();

        dragChannelTo('Quantum draniki', screen.getByText('Favourites'));

        expect(screen.queryByText(/Discord/)).not.toBeInTheDocument();

        await waitFor(() => {
            expect(storedFolders()).toEqual([
                expect.objectContaining({
                    id: 'f1',
                    channelKeys: ['discord:dumplings'],
                }),
            ]);
        });
    });

    it('keeps a channel in at most one folder when dragged between folders', async () => {
        seedFolders([
            { id: 'f1', name: 'First', channelKeys: ['discord:dumplings'] },
            { id: 'f2', name: 'Second', channelKeys: [] },
        ]);
        renderPicker();

        dragChannelTo('Quantum draniki', screen.getByText('Second'));

        await waitFor(() => {
            expect(storedFolders()).toEqual([
                expect.objectContaining({ id: 'f1', channelKeys: [] }),
                expect.objectContaining({
                    id: 'f2',
                    channelKeys: ['discord:dumplings'],
                }),
            ]);
        });
    });

    it('removes a channel from its folder when dropped outside folders', async () => {
        seedFolders([
            { id: 'f1', name: 'Favourites', channelKeys: ['discord:dumplings'] },
        ]);
        renderPicker();

        // Dropping on the tree root (outside any folder) moves the file out.
        dragChannelTo(
            'Quantum draniki',
            screen.getByRole('button', { name: /New folder/ }),
        );

        expect(screen.getByText(/Discord/)).toBeInTheDocument();

        await waitFor(() => {
            expect(storedFolders()).toEqual([
                expect.objectContaining({ id: 'f1', channelKeys: [] }),
            ]);
        });
    });

    it('shows pinned channels only in Pinned and restores them to the folder on unpin', () => {
        seedFolders([
            { id: 'f1', name: 'Favourites', channelKeys: ['discord:dumplings'] },
        ]);
        renderPicker();

        fireEvent.click(
            screen.getByRole('button', { name: 'Pin Quantum draniki' }),
        );

        expect(screen.getByText('Pinned')).toBeInTheDocument();
        expect(screen.getByText('Drag channels here')).toBeInTheDocument();

        fireEvent.click(
            screen.getByRole('button', { name: 'Unpin Quantum draniki' }),
        );

        expect(
            screen.queryByText('Drag channels here'),
        ).not.toBeInTheDocument();
        expect(screen.getByText('Quantum draniki')).toBeInTheDocument();
    });

    it('deletes a folder and returns its channels to the platform group', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        seedFolders([
            { id: 'f1', name: 'Favourites', channelKeys: ['discord:dumplings'] },
        ]);
        renderPicker();

        fireEvent.click(
            screen.getByRole('button', { name: 'Delete folder Favourites' }),
        );

        expect(screen.queryByText('Favourites')).not.toBeInTheDocument();
        expect(screen.getByText(/Discord/)).toBeInTheDocument();
        expect(screen.getByText('Quantum draniki')).toBeInTheDocument();

        await waitFor(() => {
            expect(storedFolders()).toEqual([]);
        });
    });

    it('renames a folder inline', async () => {
        seedFolders([{ id: 'f1', name: 'Favourites', channelKeys: [] }]);
        renderPicker();

        fireEvent.click(
            screen.getByRole('button', { name: 'Rename folder Favourites' }),
        );
        const input = screen.getByRole('textbox', { name: 'Folder name' });
        fireEvent.change(input, { target: { value: 'Renamed' } });
        fireEvent.blur(input);

        expect(screen.getByText('Renamed')).toBeInTheDocument();

        await waitFor(() => {
            expect(storedFolders()).toEqual([
                expect.objectContaining({ id: 'f1', name: 'Renamed' }),
            ]);
        });
    });

    it('collapses a folder and persists the collapsed state', async () => {
        seedFolders([
            { id: 'f1', name: 'Favourites', channelKeys: ['discord:dumplings'] },
        ]);
        renderPicker();

        fireEvent.click(
            screen.getByRole('button', { name: 'Collapse folder Favourites' }),
        );

        expect(screen.queryByText('Quantum draniki')).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Expand folder Favourites' }),
        ).toBeInTheDocument();

        await waitFor(() => {
            expect(storedFolders()).toEqual([
                expect.objectContaining({ id: 'f1', collapsed: true }),
            ]);
        });
    });

    it('ignores folder entries for channels that no longer exist', () => {
        seedFolders([
            { id: 'f1', name: 'Favourites', channelKeys: ['telegram:ghost'] },
        ]);
        renderPicker();

        expect(screen.getByText('Favourites')).toBeInTheDocument();
        expect(screen.getByText('Drag channels here')).toBeInTheDocument();
    });

    it('toggles all folder members via the folder All button', () => {
        seedFolders([
            {
                id: 'f1',
                name: 'Favourites',
                channelKeys: ['discord:dumplings', 'telegram:@krasny_bagatyr'],
            },
        ]);
        const onChange = renderPicker();

        // Both channels are foldered, so the only "All" button is the folder's.
        fireEvent.click(screen.getByRole('button', { name: 'All' }));

        expect(onChange).toHaveBeenCalledWith([
            { platform: 'discord', channelId: 'dumplings' },
            { platform: 'telegram', channelId: '@krasny_bagatyr' },
        ]);
    });
});
