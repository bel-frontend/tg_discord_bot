import { useEffect, useRef, useState } from 'react';
import { validatePost } from '../api';

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
 * Debounced (350ms) markdown validation, keyed on markdown changes. No cleanup-on-unmount
 * timer clear — matches the pre-existing behavior of the code this was extracted from.
 */
export function useValidation(markdown: string) {
    const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>(
        [],
    );
    const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (validateTimer.current) clearTimeout(validateTimer.current);
        validateTimer.current = setTimeout(async () => {
            if (!markdown.trim()) {
                setValidationIssues([]);
                return;
            }
            try {
                const result = await validatePost(markdown);
                setValidationIssues(result.issues);
            } catch {
                // Validation is advisory; publish still has server-side checks.
            }
        }, 350);
    }, [markdown]);

    return { validationIssues };
}
