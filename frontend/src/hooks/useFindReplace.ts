import { type RefObject, useRef, useState } from 'react';
import type Editor from '@toast-ui/editor';

interface Match {
    line: number;
    chFrom: number;
    chTo: number;
}

function findMatches(text: string, query: string): Match[] {
    if (!query) return [];
    const needle = query.toLowerCase();
    const matches: Match[] = [];
    text.split('\n').forEach((lineText, i) => {
        const haystack = lineText.toLowerCase();
        let from = 0;
        let idx: number;
        while ((idx = haystack.indexOf(needle, from)) !== -1) {
            matches.push({
                line: i + 1,
                chFrom: idx + 1,
                chTo: idx + 1 + query.length,
            });
            from = idx + needle.length;
        }
    });
    return matches;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function scrollEditorIntoView(holder: HTMLDivElement | null) {
    // Toast UI scrolls selection into view, but do a DOM fallback for long docs.
    requestAnimationFrame(() => {
        const active = holder?.querySelector(
            '.toastui-editor-md-container .toastui-editor',
        );
        active?.scrollIntoView({ block: 'center' });
    });
}

// Find/replace state machine for MarkdownEditor. Operates on the editor's plain-text
// markdown via the public Editor API, since Toast UI exposes no find/replace of its own.
export function useFindReplace(
    editorRef: RefObject<Editor | null>,
    holderRef: RefObject<HTMLDivElement | null>,
    onChangeRef: RefObject<() => void>,
) {
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [replaceText, setReplaceText] = useState('');
    const [matchIndex, setMatchIndex] = useState(-1);
    const [matchCount, setMatchCount] = useState(0);
    const queryInputRef = useRef<HTMLInputElement>(null);

    function selectMatch(match: Match) {
        const ed = editorRef.current;
        if (!ed) return;
        ed.setSelection([match.line, match.chFrom], [match.line, match.chTo]);
        ed.focus();
        scrollEditorIntoView(holderRef.current);
    }

    function refreshMatches(q: string): Match[] {
        const ed = editorRef.current;
        return ed ? findMatches(ed.getMarkdown(), q) : [];
    }

    // Updates match count/index and, unless told not to, selects the match so the
    // caller doesn't have to repeat this after every search/replace step.
    function applyMatches(
        matches: Match[],
        index: number,
        { select = true }: { select?: boolean } = {},
    ) {
        setMatchCount(matches.length);
        if (matches.length === 0) {
            setMatchIndex(-1);
            return;
        }
        const safeIndex = Math.min(Math.max(index, 0), matches.length - 1);
        setMatchIndex(safeIndex);
        if (select) selectMatch(matches[safeIndex]);
    }

    function openSearch() {
        const selected = editorRef.current?.getSelectedText() || '';
        if (selected) setQuery(selected);
        setSearchOpen(true);
        requestAnimationFrame(() => {
            queryInputRef.current?.focus();
            queryInputRef.current?.select();
        });
    }

    function closeSearch() {
        setSearchOpen(false);
        setQuery('');
        setReplaceText('');
        setMatchIndex(-1);
        setMatchCount(0);
        editorRef.current?.focus();
    }

    function runFind(direction: 'next' | 'prev') {
        const matches = refreshMatches(query);
        if (matches.length === 0) {
            applyMatches(matches, -1);
            return;
        }
        let next: number;
        if (matchIndex === -1) {
            next = direction === 'next' ? 0 : matches.length - 1;
        } else if (direction === 'next') {
            next = (matchIndex + 1) % matches.length;
        } else {
            next = (matchIndex - 1 + matches.length) % matches.length;
        }
        applyMatches(matches, next);
    }

    function handleQueryChange(value: string) {
        setQuery(value);
        applyMatches(refreshMatches(value), 0);
    }

    function handleReplaceOne() {
        const ed = editorRef.current;
        if (!ed || !query) return;
        const matches = refreshMatches(query);
        if (matchIndex < 0 || matchIndex >= matches.length) return;
        const match = matches[matchIndex];
        ed.replaceSelection(
            replaceText,
            [match.line, match.chFrom],
            [match.line, match.chTo],
        );
        onChangeRef.current?.();
        applyMatches(refreshMatches(query), matchIndex);
    }

    function handleReplaceAll() {
        const ed = editorRef.current;
        if (!ed || !query) return;
        const text = ed.getMarkdown();
        const pattern = new RegExp(escapeRegExp(query), 'gi');
        const nextText = text.replace(pattern, () => replaceText);
        if (nextText === text) return;
        ed.setMarkdown(nextText);
        onChangeRef.current?.();
        applyMatches(findMatches(nextText, query), 0, { select: false });
    }

    return {
        searchOpen,
        query,
        replaceText,
        matchIndex,
        matchCount,
        queryInputRef,
        setReplaceText,
        openSearch,
        closeSearch,
        runFind,
        handleQueryChange,
        handleReplaceOne,
        handleReplaceAll,
    };
}
