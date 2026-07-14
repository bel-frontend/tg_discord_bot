import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft, DraftFolder } from '../../../shared/types';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('../toast', () => ({
    useToast: () => vi.fn(),
}));
vi.mock('../api', () => ({
    api: apiMock,
}));

import { DraftsRail } from './DraftsRail';

function makeDraft(overrides: Partial<Draft> & { id: string }): Draft {
    return {
        title: overrides.id,
        markdown: '',
        imageUrls: [],
        imageIds: [],
        targets: [],
        silent: false,
        folderId: null,
        pinned: false,
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
        ...overrides,
    };
}

const drafts: Draft[] = [
    makeDraft({ id: 'd1', title: 'Root draft' }),
    makeDraft({ id: 'd2', title: 'Foldered draft', folderId: 'f1' }),
    makeDraft({ id: 'd3', title: 'Pinned draft', pinned: true }),
];

const folders: DraftFolder[] = [
    { id: 'f1', name: 'Favourites', order: 0, createdAt: '2026-07-01T10:00:00.000Z' },
    { id: 'f2', name: 'Archive', order: 1, createdAt: '2026-07-01T10:00:00.000Z' },
];

describe('DraftsRail', () => {
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
        apiMock.mockReset();
        apiMock.mockImplementation(async (path: string) => {
            if (path === '/api/draft-folders') return { folders };
            return {};
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renderRail(overrides: Partial<Parameters<typeof DraftsRail>[0]> = {}) {
        const props = {
            drafts,
            activeId: null,
            onNew: vi.fn(),
            onOpen: vi.fn(),
            onDelete: vi.fn(),
            onRename: vi.fn(),
            onMove: vi.fn(),
            onTogglePin: vi.fn(),
            onFolderDeleted: vi.fn(),
            ...overrides,
        };
        render(<DraftsRail {...props} />);
        return props;
    }

    it('renders pinned, folder, and root sections', async () => {
        renderRail();

        expect(await screen.findByText('Favourites')).toBeInTheDocument();
        expect(screen.getByText('Pinned')).toBeInTheDocument();
        expect(screen.getByText('Pinned draft')).toBeInTheDocument();
        expect(screen.getByText('Foldered draft')).toBeInTheDocument();
        expect(screen.getByText('Root draft')).toBeInTheDocument();
    });

    it('creates a folder via the API and lets the user name it inline', async () => {
        apiMock.mockImplementation(async (path: string, opts?: any) => {
            if (path === '/api/draft-folders' && opts?.method === 'POST') {
                return {
                    folder: {
                        id: 'f-new',
                        name: 'New folder',
                        order: 2,
                        createdAt: '2026-07-09T10:00:00.000Z',
                    },
                };
            }
            if (path === '/api/draft-folders') return { folders: [] };
            return {};
        });
        renderRail();

        fireEvent.click(screen.getByRole('button', { name: 'New folder' }));

        const input = await screen.findByRole('textbox', {
            name: 'Folder name',
        });
        fireEvent.change(input, { target: { value: 'Ideas' } });
        fireEvent.blur(input);

        expect(screen.getByText('Ideas')).toBeInTheDocument();
        await waitFor(() => {
            expect(apiMock).toHaveBeenCalledWith('/api/draft-folders/f-new', {
                method: 'PUT',
                body: { name: 'Ideas' },
            });
        });
    });

    it('renames a folder inline via the API', async () => {
        renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(
            screen.getByRole('button', { name: 'Rename folder Favourites' }),
        );
        const input = screen.getByRole('textbox', { name: 'Folder name' });
        fireEvent.change(input, { target: { value: 'Renamed' } });
        fireEvent.blur(input);

        expect(screen.getByText('Renamed')).toBeInTheDocument();
        await waitFor(() => {
            expect(apiMock).toHaveBeenCalledWith('/api/draft-folders/f1', {
                method: 'PUT',
                body: { name: 'Renamed' },
            });
        });
    });

    it('renames a draft inline through onRename', async () => {
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(
            screen.getByRole('button', { name: 'Rename Root draft' }),
        );
        const input = screen.getByRole('textbox', { name: 'Draft title' });
        fireEvent.change(input, { target: { value: 'Better title' } });
        fireEvent.blur(input);

        expect(props.onRename).toHaveBeenCalledWith('d1', 'Better title');
    });

    it('toggles pinning through onTogglePin', async () => {
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(
            screen.getByRole('button', { name: 'Pin Root draft' }),
        );
        expect(props.onTogglePin).toHaveBeenCalledWith('d1');

        fireEvent.click(
            screen.getByRole('button', { name: 'Unpin Pinned draft' }),
        );
        expect(props.onTogglePin).toHaveBeenCalledWith('d3');
    });

    it('moves a draft into a folder via drag and drop', async () => {
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.dragStart(screen.getByText('Root draft'));
        fireEvent.drop(screen.getByText('Archive'));

        expect(props.onMove).toHaveBeenCalledWith('d1', 'f2');
    });

    it('moves a draft back to the root when dropped outside folders', async () => {
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.dragStart(screen.getByText('Foldered draft'));
        fireEvent.drop(screen.getByText('Root draft'));

        expect(props.onMove).toHaveBeenCalledWith('d2', null);
    });

    it('reorders folders by dropping one folder on another', async () => {
        renderRail();
        await screen.findByText('Favourites');

        fireEvent.dragStart(screen.getByText('Archive'));
        fireEvent.drop(screen.getByText('Favourites'));

        await waitFor(() => {
            expect(apiMock).toHaveBeenCalledWith('/api/draft-folders/order', {
                method: 'PUT',
                body: { ids: ['f2', 'f1'] },
            });
        });
    });

    it('deletes a folder after confirmation and reports it upward (cascade-deletes its drafts)', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(
            screen.getByRole('button', { name: 'Delete folder Favourites' }),
        );

        expect(screen.queryByText('Favourites')).not.toBeInTheDocument();
        await waitFor(() => {
            expect(apiMock).toHaveBeenCalledWith('/api/draft-folders/f1', {
                method: 'DELETE',
            });
        });
        await waitFor(() => {
            expect(props.onFolderDeleted).toHaveBeenCalledWith('f1');
        });
    });

    it('does not report the folder deleted upward when the API call fails', async () => {
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        apiMock.mockImplementation(async (path: string, opts?: any) => {
            if (path === '/api/draft-folders') return { folders };
            if (path === '/api/draft-folders/f1' && opts?.method === 'DELETE') {
                throw new Error('boom');
            }
            return {};
        });
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(
            screen.getByRole('button', { name: 'Delete folder Favourites' }),
        );

        await waitFor(() => {
            expect(apiMock).toHaveBeenCalledWith('/api/draft-folders/f1', {
                method: 'DELETE',
            });
        });
        expect(props.onFolderDeleted).not.toHaveBeenCalled();
    });

    it('collapses a folder and keeps the state in localStorage', async () => {
        renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(
            screen.getByRole('button', { name: 'Collapse folder Favourites' }),
        );

        expect(screen.queryByText('Foldered draft')).not.toBeInTheDocument();
        await waitFor(() => {
            expect(
                JSON.parse(
                    window.localStorage.getItem(
                        'composer:draftFolderCollapsed',
                    ) ?? '{}',
                ),
            ).toEqual({ f1: true });
        });
    });

    it('opens a draft when its row is clicked', async () => {
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(screen.getByText('Root draft'));

        expect(props.onOpen).toHaveBeenCalledWith('d1');
    });

    it('creates a new draft in the selected folder, defaulting to root when none is selected', async () => {
        const props = renderRail();
        await screen.findByText('Favourites');

        fireEvent.click(screen.getByRole('button', { name: '＋ New' }));
        expect(props.onNew).toHaveBeenLastCalledWith(null);

        fireEvent.click(
            screen.getByRole('button', { name: 'Select folder Favourites' }),
        );
        fireEvent.click(screen.getByRole('button', { name: '＋ New' }));
        expect(props.onNew).toHaveBeenLastCalledWith('f1');
    });

    it('deselects a folder by clicking it again', async () => {
        const props = renderRail();
        await screen.findByText('Favourites');

        const favouritesButton = screen.getByRole('button', {
            name: 'Select folder Favourites',
        });
        fireEvent.click(favouritesButton);
        fireEvent.click(screen.getByRole('button', { name: '＋ New' }));
        expect(props.onNew).toHaveBeenLastCalledWith('f1');

        fireEvent.click(favouritesButton);
        fireEvent.click(screen.getByRole('button', { name: '＋ New' }));
        expect(props.onNew).toHaveBeenLastCalledWith(null);
    });

    it('moves a dragged folder to the end of the list when dropped on the root area', async () => {
        renderRail();
        await screen.findByText('Favourites');

        fireEvent.dragStart(screen.getByText('Favourites'));
        fireEvent.drop(screen.getByText('Root draft'));

        await waitFor(() => {
            expect(apiMock).toHaveBeenCalledWith('/api/draft-folders/order', {
                method: 'PUT',
                body: { ids: ['f2', 'f1'] },
            });
        });
    });
});
