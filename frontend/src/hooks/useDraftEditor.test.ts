import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../toast', () => ({
    useToast: () => vi.fn(),
}));
vi.mock('../api', () => ({
    api: vi.fn(),
}));

import { useDraftEditor } from './useDraftEditor';

function makeEditorRef(initialMarkdown = '') {
    let markdown = initialMarkdown;
    return {
        current: {
            getMarkdown: () => markdown,
            setMarkdown: (md: string) => {
                markdown = md;
            },
            focusLine: vi.fn(),
        },
    };
}

describe('useDraftEditor', () => {
    it('collect() derives title from markdown, reads fresh markdown, maps images/targets', () => {
        const editorRef = makeEditorRef('hello world');
        const setDrafts = vi.fn();
        const { result } = renderHook(() => useDraftEditor(editorRef as any, setDrafts));

        act(() => {
            result.current.setTitle('   ');
            result.current.setImageUrls(' https://a.png , https://b.png ,, ');
            result.current.setImages([
                { id: 'img1', filename: 'a', previewUrl: 'blob:a' },
                { id: 'img2', filename: 'b', previewUrl: 'blob:b' },
            ]);
            result.current.setTargets([{ platform: 'telegram', channelId: 'x' }]);
        });

        const data = result.current.collect();
        expect(data.title).toBe('hello world');
        expect(data.markdown).toBe('hello world');
        expect(data.imageUrls).toEqual(['https://a.png', 'https://b.png']);
        expect(data.imageIds).toEqual(['img1', 'img2']);
        expect(data.targets).toEqual([{ platform: 'telegram', channelId: 'x' }]);
    });

    it('collect() defaults title to Untitled when both title and markdown are blank', () => {
        const editorRef = makeEditorRef('');
        const setDrafts = vi.fn();
        const { result } = renderHook(() => useDraftEditor(editorRef as any, setDrafts));

        act(() => {
            result.current.setTitle('   ');
        });

        expect(result.current.collect().title).toBe('Untitled');
    });

    it('collect() trims and keeps a non-empty title', () => {
        const editorRef = makeEditorRef('');
        const setDrafts = vi.fn();
        const { result } = renderHook(() => useDraftEditor(editorRef as any, setDrafts));

        act(() => {
            result.current.setTitle('  My Post  ');
        });

        expect(result.current.collect().title).toBe('My Post');
    });

    it('parseImageUrls splits, trims, and filters empty entries', () => {
        const editorRef = makeEditorRef('');
        const setDrafts = vi.fn();
        const { result } = renderHook(() => useDraftEditor(editorRef as any, setDrafts));

        act(() => {
            result.current.setImageUrls('a, , b ,   ,c');
        });

        expect(result.current.parseImageUrls()).toEqual(['a', 'b', 'c']);
    });

    it('parseImageUrls returns an empty array when imageUrls is blank', () => {
        const editorRef = makeEditorRef('');
        const setDrafts = vi.fn();
        const { result } = renderHook(() => useDraftEditor(editorRef as any, setDrafts));

        expect(result.current.parseImageUrls()).toEqual([]);
    });

    it('collect() defaults folderId to null', () => {
        const editorRef = makeEditorRef('');
        const setDrafts = vi.fn();
        const { result } = renderHook(() => useDraftEditor(editorRef as any, setDrafts));

        expect(result.current.collect().folderId).toBeNull();
    });

    it('resetForNewDraft(folderId) carries the folder into the next collect()', () => {
        const editorRef = makeEditorRef('');
        const setDrafts = vi.fn();
        const { result } = renderHook(() => useDraftEditor(editorRef as any, setDrafts));

        act(() => {
            result.current.resetForNewDraft('folder1');
        });
        expect(result.current.collect().folderId).toBe('folder1');

        act(() => {
            result.current.resetForNewDraft();
        });
        expect(result.current.collect().folderId).toBeNull();
    });
});
