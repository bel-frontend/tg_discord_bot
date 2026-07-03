import { useEffect, useMemo, useRef, useState } from 'react';
import { validatePost } from '../api';
import type { Target } from '../../../shared/types';

export interface ValidationIssue {
    platform: string;
    chunk: number;
    message: string;
    tag?: string;
    offset?: number;
    line?: number;
    excerpt?: string;
    htmlContext?: string;
}

/**
 * Debounced (350ms) markdown validation, keyed on markdown and target-platform changes.
 * Only validates against platforms actually selected as targets — a Discord markdown
 * quirk or a Threads character limit is noise if this post isn't going there. No
 * cleanup-on-unmount timer clear — matches the pre-existing behavior of the code this
 * was extracted from.
 */
export function useValidation(markdown: string, targets: Target[]) {
    const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>(
        [],
    );
    const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const platformIds = useMemo(
        () => [...new Set(targets.map((t) => t.platform))].sort(),
        [targets],
    );
    const platformIdsKey = platformIds.join(',');

    useEffect(() => {
        if (validateTimer.current) clearTimeout(validateTimer.current);
        validateTimer.current = setTimeout(async () => {
            if (!markdown.trim() || !platformIds.length) {
                setValidationIssues([]);
                return;
            }
            try {
                const result = await validatePost(markdown, platformIds);
                setValidationIssues(result.issues);
            } catch {
                // Validation is advisory; publish still has server-side checks.
            }
        }, 350);
        // Depend on the joined string, not the platformIds array: a fresh array
        // reference from useMemo would reset the debounce timer every render even
        // when the actual set of target platforms hasn't changed.
    }, [markdown, platformIdsKey]);

    return { validationIssues };
}
