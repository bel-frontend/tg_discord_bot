import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../toast', () => ({
    useToast: () => vi.fn(),
}));
vi.mock('../api', () => ({
    api: vi.fn(),
}));

import { api } from '../api';
import { usePublications } from './usePublications';

function makeEditorRef(markdown = 'hello') {
    return {
        current: {
            getMarkdown: () => markdown,
            setMarkdown: vi.fn(),
            focusLine: vi.fn(),
        },
    };
}

describe('usePublications', () => {
    beforeEach(() => {
        vi.mocked(api).mockReset();
        vi.stubGlobal('confirm', vi.fn(() => true));
    });

    it('publish() ensures a draft, then POSTs the expected body and reloads publications', async () => {
        vi.mocked(api).mockImplementation(async (path: string) => {
            if (path === '/api/publish') {
                return {
                    results: [
                        { platform: 'telegram', channelId: 'c1', ok: true, messageIds: ['1'] },
                    ],
                };
            }
            if (path.startsWith('/api/publications?')) {
                return { publications: [] };
            }
            throw new Error('unexpected api call: ' + path);
        });

        const { result } = renderHook(() => usePublications());
        const ensureDraftForPublish = vi.fn().mockResolvedValue('draft1');

        await act(async () => {
            await result.current.publish({
                editorRef: makeEditorRef('hello world') as any,
                targets: [{ platform: 'telegram', channelId: 'c1' }],
                images: [],
                parseImageUrls: () => [],
                title: 'My Post',
                validationIssues: [],
                ensureDraftForPublish,
            });
        });

        expect(ensureDraftForPublish).toHaveBeenCalledTimes(1);
        expect(api).toHaveBeenCalledWith('/api/publish', {
            method: 'POST',
            body: {
                draftId: 'draft1',
                title: 'My Post',
                markdown: 'hello world',
                imageUrls: [],
                imageIds: [],
                targets: [{ platform: 'telegram', channelId: 'c1' }],
            },
        });
        expect(result.current.results).toEqual([
            { platform: 'telegram', channelId: 'c1', ok: true, messageIds: ['1'] },
        ]);
    });

    it('publish() makes no API call when there are no targets', async () => {
        const { result } = renderHook(() => usePublications());
        const ensureDraftForPublish = vi.fn();

        await act(async () => {
            await result.current.publish({
                editorRef: makeEditorRef('hello') as any,
                targets: [],
                images: [],
                parseImageUrls: () => [],
                title: '',
                validationIssues: [],
                ensureDraftForPublish,
            });
        });

        expect(ensureDraftForPublish).not.toHaveBeenCalled();
        expect(api).not.toHaveBeenCalled();
    });

    it('publish() makes no API call when there are validation issues', async () => {
        const { result } = renderHook(() => usePublications());
        const ensureDraftForPublish = vi.fn();

        await act(async () => {
            await result.current.publish({
                editorRef: makeEditorRef('hello') as any,
                targets: [{ platform: 'telegram', channelId: 'c1' }],
                images: [],
                parseImageUrls: () => [],
                title: '',
                validationIssues: [
                    { platform: 'telegram', chunk: 1, message: 'broken tag' },
                ],
                ensureDraftForPublish,
            });
        });

        expect(ensureDraftForPublish).not.toHaveBeenCalled();
        expect(api).not.toHaveBeenCalled();
    });

    it('updatePublished() hits the update endpoint and replaces the publication in state', async () => {
        vi.mocked(api).mockResolvedValue({
            results: [{ platform: 'telegram', channelId: 'c1', ok: true, messageIds: ['1'] }],
            publication: {
                id: 'pub1',
                draftId: 'd1',
                title: 'New title',
                markdown: 'new content',
                imageUrls: [],
                targets: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
            },
        });

        const { result } = renderHook(() => usePublications());
        const existing = {
            id: 'pub1',
            draftId: 'd1',
            title: 'old',
            markdown: 'old',
            imageUrls: [],
            targets: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };

        await act(async () => {
            await result.current.updatePublished(existing, {
                editorRef: makeEditorRef('new content') as any,
                title: 'New title',
                parseImageUrls: () => [],
                validationIssues: [],
            });
        });

        expect(api).toHaveBeenCalledWith('/api/publications/pub1/update', {
            method: 'POST',
            body: { title: 'New title', markdown: 'new content', imageUrls: [] },
        });
        expect(result.current.publications).toHaveLength(1);
        expect(result.current.publications[0].title).toBe('New title');
    });

    it('deletePublished() hits the delete endpoint and removes the publication from state on success', async () => {
        const seeded = {
            id: 'pub1',
            draftId: 'd1',
            title: 'x',
            markdown: 'y',
            imageUrls: [],
            targets: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        vi.mocked(api).mockResolvedValueOnce({ publications: [seeded] });

        const { result } = renderHook(() => usePublications());
        await act(async () => {
            await result.current.loadPublications('d1');
        });
        expect(result.current.publications).toHaveLength(1);

        vi.mocked(api).mockResolvedValueOnce({
            results: [{ platform: 'telegram', channelId: 'c1', ok: true, messageIds: ['1'] }],
            deleted: true,
        });

        await act(async () => {
            await result.current.deletePublished(result.current.publications[0]);
        });

        expect(api).toHaveBeenCalledWith('/api/publications/pub1/delete', {
            method: 'POST',
        });
        expect(result.current.publications).toHaveLength(0);
    });

    it('deletePublished() keeps the publication in state when deletion is not fully ok', async () => {
        const seeded = {
            id: 'pub1',
            draftId: 'd1',
            title: 'x',
            markdown: 'y',
            imageUrls: [],
            targets: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        };
        vi.mocked(api).mockResolvedValueOnce({ publications: [seeded] });

        const { result } = renderHook(() => usePublications());
        await act(async () => {
            await result.current.loadPublications('d1');
        });

        vi.mocked(api).mockResolvedValueOnce({
            results: [
                { platform: 'telegram', channelId: 'c1', ok: false, error: 'boom' },
            ],
            deleted: false,
        });

        await act(async () => {
            await result.current.deletePublished(result.current.publications[0]);
        });

        expect(result.current.publications).toHaveLength(1);
    });

    it('reset() clears publications and results', async () => {
        vi.mocked(api).mockResolvedValueOnce({
            publications: [
                {
                    id: 'pub1',
                    draftId: 'd1',
                    title: 'x',
                    markdown: 'y',
                    imageUrls: [],
                    targets: [],
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
            ],
        });
        const { result } = renderHook(() => usePublications());
        await act(async () => {
            await result.current.loadPublications('d1');
        });
        expect(result.current.publications).toHaveLength(1);

        act(() => {
            result.current.reset();
        });

        expect(result.current.publications).toEqual([]);
        expect(result.current.results).toBeNull();
    });
});
