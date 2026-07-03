import { useCallback, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import type { Draft } from '../../../shared/types';

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

    return { drafts, setDrafts, loadDrafts, deleteDraft };
}
