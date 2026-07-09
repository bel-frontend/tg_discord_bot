import { useCallback, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import type { Draft } from '../../../shared/types';

interface DraftPatch {
    title?: string;
    folderId?: string | null;
    pinned?: boolean;
}

/** Loads the draft list and owns delete-from-list; the "current draft" lives in useDraftEditor. */
export function useDrafts() {
    const toast = useToast();
    const [drafts, setDrafts] = useState<Draft[]>([]);

    const loadDrafts = useCallback(async () => {
        const { drafts } = await api<{ drafts: Draft[] }>('/api/drafts');
        setDrafts(drafts);
    }, []);

    /** Returns true if the draft was deleted, so callers can reset an open editor. */
    const deleteDraft = useCallback(
        async (id: string): Promise<boolean> => {
            if (
                !confirm(
                    'Delete this draft and its scheduled/publication records?',
                )
            ) {
                return false;
            }
            try {
                await api(`/api/drafts/${id}`, { method: 'DELETE' });
                setDrafts((cur) => cur.filter((d) => d.id !== id));
                toast('Draft deleted', 'success');
                return true;
            } catch (err: any) {
                toast(err.message, 'error');
                return false;
            }
        },
        [toast],
    );

    /** Optimistic partial update (rename/move/pin) — replaces the draft in
     * place so its position in the list never changes. */
    const patchDraft = useCallback(
        async (id: string, patch: DraftPatch) => {
            setDrafts((cur) =>
                cur.map((d) => (d.id === id ? { ...d, ...patch } : d)),
            );
            try {
                const { draft } = await api<{ draft: Draft }>(
                    `/api/drafts/${id}`,
                    { method: 'PATCH', body: patch },
                );
                setDrafts((cur) =>
                    cur.map((d) => (d.id === id ? draft : d)),
                );
            } catch (err: any) {
                toast(err.message, 'error');
                loadDrafts().catch(() => {});
            }
        },
        [toast, loadDrafts],
    );

    const renameDraft = useCallback(
        (id: string, title: string) => {
            const trimmed = title.trim();
            if (!trimmed) return Promise.resolve();
            return patchDraft(id, { title: trimmed });
        },
        [patchDraft],
    );

    const moveDraft = useCallback(
        (id: string, folderId: string | null) => patchDraft(id, { folderId }),
        [patchDraft],
    );

    const togglePinned = useCallback(
        (id: string) => {
            const draft = drafts.find((d) => d.id === id);
            if (!draft) return Promise.resolve();
            return patchDraft(id, { pinned: !draft.pinned });
        },
        [drafts, patchDraft],
    );

    return {
        drafts,
        setDrafts,
        loadDrafts,
        deleteDraft,
        renameDraft,
        moveDraft,
        togglePinned,
    };
}
