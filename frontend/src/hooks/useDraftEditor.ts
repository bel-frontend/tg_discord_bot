import {
    useCallback,
    useRef,
    useState,
    type Dispatch,
    type RefObject,
    type SetStateAction,
} from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import type { Draft, Target } from '../../../shared/types';
import type { MarkdownEditorHandle } from '../components/MarkdownEditor';
import type { ImageItem } from '../components/ImageUploader';

/**
 * Owns the "currently open draft" state machine: title/markdown/images/targets, plus save.
 * Refs mirror each piece of state so debounced callers (autosave) always read fresh values
 * without needing to resubscribe their timers on every keystroke.
 */
export function useDraftEditor(
    editorRef: RefObject<MarkdownEditorHandle>,
    setDrafts: Dispatch<SetStateAction<Draft[]>>,
) {
    const toast = useToast();

    const [draftId, setDraftId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [imageUrls, setImageUrls] = useState('');
    const [images, setImages] = useState<ImageItem[]>([]);
    const [targets, setTargets] = useState<Target[]>([]);
    const [silent, setSilent] = useState(false);
    const [saveStatus, setSaveStatus] = useState('');
    const [charCount, setCharCount] = useState(0);
    const [markdown, setMarkdown] = useState('');

    // Mirror the latest state into refs so the debounced save reads fresh values.
    const draftIdRef = useRef(draftId);
    const titleRef = useRef(title);
    const imageUrlsRef = useRef(imageUrls);
    const imagesRef = useRef(images);
    const targetsRef = useRef(targets);
    const silentRef = useRef(silent);
    draftIdRef.current = draftId;
    titleRef.current = title;
    imageUrlsRef.current = imageUrls;
    imagesRef.current = images;
    targetsRef.current = targets;
    silentRef.current = silent;

    const parseImageUrls = useCallback(
        () =>
            imageUrlsRef.current
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
        [],
    );

    const collect = useCallback(
        () => ({
            title: titleRef.current.trim() || 'Untitled',
            markdown: editorRef.current?.getMarkdown() ?? '',
            imageUrls: parseImageUrls(),
            imageIds: imagesRef.current.map((i) => i.id),
            targets: targetsRef.current,
            silent: silentRef.current,
        }),
        [editorRef, parseImageUrls],
    );

    const saveDraft = useCallback(
        async (silent: boolean) => {
            const data = collect();
            if (!data.markdown.trim() && data.title === 'Untitled') {
                if (!silent) toast('Nothing to save yet', 'warn');
                return;
            }
            try {
                if (draftIdRef.current) {
                    const { draft } = await api<{ draft: Draft }>(
                        `/api/drafts/${draftIdRef.current}`,
                        { method: 'PUT', body: data },
                    );
                    setDrafts((cur) => [
                        draft,
                        ...cur.filter((d) => d.id !== draft.id),
                    ]);
                } else {
                    const { draft } = await api<{ draft: Draft }>(
                        '/api/drafts',
                        { method: 'POST', body: data },
                    );
                    setDraftId(draft.id);
                    setDrafts((cur) => [draft, ...cur]);
                }
                setSaveStatus('Saved ✓');
                if (!silent) toast('Draft saved', 'success');
            } catch (err: any) {
                setSaveStatus('');
                toast(err.message, 'error');
            }
        },
        [collect, setDrafts, toast],
    );

    function revokeImages() {
        for (const img of imagesRef.current) URL.revokeObjectURL(img.previewUrl);
    }

    /** Apply a loaded draft's fields into editor state. */
    function applyDraft(draft: Draft) {
        setDraftId(draft.id);
        setTitle(draft.title === 'Untitled' ? '' : draft.title);
        setImageUrls((draft.imageUrls || []).join(', '));
        setTargets(draft.targets || []);
        setSilent(draft.silent ?? false);
        editorRef.current?.setMarkdown(draft.markdown || '');
        setMarkdown(draft.markdown || '');
        setCharCount((draft.markdown || '').length);
        setSaveStatus('');
    }

    /** Clear editor state for a brand new draft (caller wraps this with autosave suppression). */
    function resetForNewDraft() {
        setDraftId(null);
        setTitle('');
        setImageUrls('');
        setTargets([]);
        setSilent(false);
        editorRef.current?.setMarkdown('');
        setMarkdown('');
        setCharCount(0);
        setSaveStatus('');
    }

    async function ensureDraftForPublish(): Promise<string> {
        if (draftIdRef.current) return draftIdRef.current;

        const data = collect();
        const { draft } = await api<{ draft: Draft }>('/api/drafts', {
            method: 'POST',
            body: data,
        });
        setDraftId(draft.id);
        setDrafts((cur) => [draft, ...cur]);
        setSaveStatus('Saved ✓');
        return draft.id;
    }

    async function ensureDraftSaved(): Promise<string> {
        const data = collect();
        if (draftIdRef.current) {
            const { draft } = await api<{ draft: Draft }>(
                `/api/drafts/${draftIdRef.current}`,
                { method: 'PUT', body: data },
            );
            setDrafts((cur) => [
                draft,
                ...cur.filter((d) => d.id !== draft.id),
            ]);
            setSaveStatus('Saved ✓');
            return draft.id;
        }

        const { draft } = await api<{ draft: Draft }>('/api/drafts', {
            method: 'POST',
            body: data,
        });
        setDraftId(draft.id);
        setDrafts((cur) => [draft, ...cur]);
        setSaveStatus('Saved ✓');
        return draft.id;
    }

    /** Sync charCount/markdown state from the editor's current content on every keystroke. */
    function handleEditorContentChange() {
        const md = editorRef.current?.getMarkdown() ?? '';
        setCharCount(md.length);
        setMarkdown(md);
    }

    return {
        draftId,
        title,
        setTitle,
        imageUrls,
        setImageUrls,
        images,
        setImages,
        targets,
        setTargets,
        silent,
        setSilent,
        saveStatus,
        setSaveStatus,
        charCount,
        markdown,
        collect,
        parseImageUrls,
        saveDraft,
        revokeImages,
        applyDraft,
        resetForNewDraft,
        ensureDraftForPublish,
        ensureDraftSaved,
        handleEditorContentChange,
    };
}

export type DraftEditor = ReturnType<typeof useDraftEditor>;
