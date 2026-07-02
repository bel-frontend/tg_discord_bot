import { useCallback, useRef } from 'react';

/**
 * Generic debounced-save primitive. `collect` decides whether there's anything worth
 * saving; `saveDraft`/`setSaveStatus` are supplied by the caller (useDraftEditor).
 */
export function useAutosave(
    collect: () => { title: string; markdown: string },
    saveDraft: (silent: boolean) => Promise<void>,
    setSaveStatus: (status: string) => void,
    delayMs = 1000,
) {
    const suppressSave = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const scheduleSave = useCallback(() => {
        if (suppressSave.current) return;
        const data = collect();
        if (!data.markdown.trim() && data.title === 'Untitled') return;
        setSaveStatus('Saving…');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => saveDraft(true), delayMs);
    }, [collect, saveDraft, setSaveStatus, delayMs]);

    function withSuppressed(fn: () => void) {
        suppressSave.current = true;
        fn();
        // Release after the editor's change event has flushed.
        setTimeout(() => {
            suppressSave.current = false;
        }, 50);
    }

    return { scheduleSave, withSuppressed };
}
