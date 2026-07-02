import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
    fetchImageObjectUrl: vi.fn(),
}));

import { fetchImageObjectUrl } from '../api';
import { loadImagePreviews } from './useImagePreviews';

describe('loadImagePreviews', () => {
    it('resolves ids to preview items, preserving order, filtering failures', async () => {
        vi.mocked(fetchImageObjectUrl).mockImplementation(async (id: string) => {
            if (id === 'bad') throw new Error('404');
            return `blob:${id}`;
        });

        const result = await loadImagePreviews(['a', 'bad', 'b']);

        expect(result).toEqual([
            { id: 'a', filename: 'image', previewUrl: 'blob:a' },
            { id: 'b', filename: 'image', previewUrl: 'blob:b' },
        ]);
    });

    it('returns an empty array for no ids', async () => {
        const result = await loadImagePreviews([]);
        expect(result).toEqual([]);
    });
});
