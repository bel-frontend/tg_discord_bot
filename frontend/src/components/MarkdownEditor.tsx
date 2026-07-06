import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from 'react';
import Editor from '@toast-ui/editor';

export interface MarkdownEditorHandle {
    getMarkdown: () => string;
    setMarkdown: (md: string) => void;
    focusLine: (line: number) => void;
}

interface Props {
    theme: 'dark' | 'light';
    onChange: () => void;
}

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

// Wraps the vanilla Toast UI Editor so we don't depend on its (older) React binding.
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(
    ({ theme, onChange }, ref) => {
        const holder = useRef<HTMLDivElement>(null);
        const editor = useRef<Editor | null>(null);
        const pendingMarkdown = useRef<string | null>(null);
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;

        const [searchOpen, setSearchOpen] = useState(false);
        const [query, setQuery] = useState('');
        const [replaceText, setReplaceText] = useState('');
        const [matchIndex, setMatchIndex] = useState(-1);
        const [matchCount, setMatchCount] = useState(0);
        const queryInputRef = useRef<HTMLInputElement>(null);

        useImperativeHandle(ref, () => ({
            getMarkdown: () => editor.current?.getMarkdown() ?? '',
            setMarkdown: (md: string) => {
                const next = md ?? '';
                if (editor.current) {
                    editor.current.setMarkdown(next);
                    pendingMarkdown.current = null;
                } else {
                    pendingMarkdown.current = next;
                }
            },
            focusLine: (line: number) => {
                const ed = editor.current;
                if (!ed) return;
                const safeLine = Math.max(1, Math.floor(line || 1));
                ed.setSelection([safeLine, 1], [safeLine, 1]);
                ed.focus();

                // Toast UI scrolls selection into view, but do a DOM fallback for long docs.
                requestAnimationFrame(() => {
                    const active = holder.current?.querySelector(
                        '.toastui-editor-md-container .toastui-editor',
                    );
                    active?.scrollIntoView({ block: 'center' });
                });
            },
        }));

        function wrapSelection(open: string, close: string) {
            const ed = editor.current;
            if (!ed) return;
            const selected = ed.getSelectedText() || '';
            ed.replaceSelection(`${open}${selected}${close}`);
            ed.focus();
            onChangeRef.current();
        }

        function selectMatch(match: Match) {
            const ed = editor.current;
            if (!ed) return;
            ed.setSelection([match.line, match.chFrom], [match.line, match.chTo]);
            ed.focus();

            // Toast UI scrolls selection into view, but do a DOM fallback for long docs.
            requestAnimationFrame(() => {
                const active = holder.current?.querySelector(
                    '.toastui-editor-md-container .toastui-editor',
                );
                active?.scrollIntoView({ block: 'center' });
            });
        }

        function openSearch() {
            const ed = editor.current;
            const selected = ed?.getSelectedText() || '';
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
            editor.current?.focus();
        }

        function runFind(direction: 'next' | 'prev', q: string = query) {
            const ed = editor.current;
            if (!ed || !q) {
                setMatchCount(0);
                setMatchIndex(-1);
                return;
            }
            const matches = findMatches(ed.getMarkdown(), q);
            setMatchCount(matches.length);
            if (matches.length === 0) {
                setMatchIndex(-1);
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
            setMatchIndex(next);
            selectMatch(matches[next]);
        }

        function handleQueryChange(value: string) {
            setQuery(value);
            const ed = editor.current;
            if (!ed || !value) {
                setMatchCount(0);
                setMatchIndex(-1);
                return;
            }
            const matches = findMatches(ed.getMarkdown(), value);
            setMatchCount(matches.length);
            if (matches.length === 0) {
                setMatchIndex(-1);
                return;
            }
            setMatchIndex(0);
            selectMatch(matches[0]);
        }

        function handleReplaceOne() {
            const ed = editor.current;
            if (!ed || !query) return;
            const matches = findMatches(ed.getMarkdown(), query);
            if (matchIndex < 0 || matchIndex >= matches.length) return;
            const match = matches[matchIndex];
            ed.replaceSelection(
                replaceText,
                [match.line, match.chFrom],
                [match.line, match.chTo],
            );
            onChangeRef.current();

            const nextMatches = findMatches(ed.getMarkdown(), query);
            setMatchCount(nextMatches.length);
            if (nextMatches.length === 0) {
                setMatchIndex(-1);
                return;
            }
            const nextIndex = Math.min(matchIndex, nextMatches.length - 1);
            setMatchIndex(nextIndex);
            selectMatch(nextMatches[nextIndex]);
        }

        function handleReplaceAll() {
            const ed = editor.current;
            if (!ed || !query) return;
            const text = ed.getMarkdown();
            const pattern = new RegExp(escapeRegExp(query), 'gi');
            const nextText = text.replace(pattern, () => replaceText);
            if (nextText === text) return;
            ed.setMarkdown(nextText);
            onChangeRef.current();

            const remaining = findMatches(nextText, query);
            setMatchCount(remaining.length);
            setMatchIndex(remaining.length > 0 ? 0 : -1);
        }

        function customButton(
            name: string,
            label: string,
            title: string,
            onClick: () => void,
        ): HTMLButtonElement {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.name = name;
            btn.className = 'tui-custom-btn';
            btn.title = title;
            const span = document.createElement('span');
            span.className = 'tui-custom-btn-label';
            span.textContent = label;
            btn.appendChild(span);
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                onClick();
            });
            return btn;
        }

        // Recreate the editor when the theme changes so its styling matches.
        useEffect(() => {
            if (!holder.current) return;
            const initialValue =
                pendingMarkdown.current ?? editor.current?.getMarkdown() ?? '';
            pendingMarkdown.current = null;

            const nextEditor = new Editor({
                el: holder.current,
                height: '100%',
                initialEditType: 'markdown',
                previewStyle: 'tab',
                usageStatistics: false,
                theme: theme === 'dark' ? 'dark' : 'default',
                initialValue,
                // Match the formatting Telegram/Discord can actually publish.
                // No hr/table/task-list: those leak as unsupported markdown in targets.
                toolbarItems: [
                    ['heading', 'bold', 'italic', 'strike'],
                    [
                        {
                            name: 'underline',
                            tooltip: 'Underline (Ctrl/Cmd+U)',
                            el: customButton('underline', 'U', 'Underline', () =>
                                wrapSelection('__', '__'),
                            ),
                        },
                        {
                            name: 'spoiler',
                            tooltip: 'Spoiler',
                            el: customButton('spoiler', '▨', 'Spoiler', () =>
                                wrapSelection('||', '||'),
                            ),
                        },
                    ],
                    ['quote', 'ul', 'ol'],
                    ['link', 'code', 'codeblock'],
                    [
                        {
                            name: 'search',
                            tooltip: 'Find & replace (Ctrl/Cmd+F)',
                            el: customButton('search', '🔍', 'Find & replace', () =>
                                openSearch(),
                            ),
                        },
                    ],
                ],
                events: {
                    change: () => {
                        pendingMarkdown.current = null;
                        onChangeRef.current();
                    },
                },
            });
            editor.current = nextEditor;

            const holderEl = holder.current;
            const onKeyDown = (e: KeyboardEvent) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
                    e.preventDefault();
                    wrapSelection('__', '__');
                } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
                    e.preventDefault();
                    openSearch();
                }
            };
            holderEl.addEventListener('keydown', onKeyDown, true);

            return () => {
                holderEl.removeEventListener('keydown', onKeyDown, true);
                // Cleanup runs before the next effect body, so stash the content
                // here or the theme-change re-mount below will see a null editor.
                pendingMarkdown.current = nextEditor.getMarkdown();
                nextEditor.destroy();
                if (editor.current === nextEditor) {
                    editor.current = null;
                }
            };
        }, [theme]);

        return (
            <div className="editor-wrap">
                <div className="editor-holder" ref={holder} />
                {searchOpen && (
                    <div className="editor-search-panel">
                        <input
                            ref={queryInputRef}
                            type="text"
                            placeholder="Find"
                            value={query}
                            onChange={(e) => handleQueryChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    runFind(e.shiftKey ? 'prev' : 'next');
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    closeSearch();
                                }
                            }}
                        />
                        <span className="match-count">
                            {query
                                ? matchCount > 0
                                    ? `${matchIndex + 1}/${matchCount}`
                                    : 'No results'
                                : ''}
                        </span>
                        <button
                            type="button"
                            className="btn small ghost"
                            title="Previous match"
                            disabled={matchCount === 0}
                            onClick={() => runFind('prev')}
                        >
                            ↑
                        </button>
                        <button
                            type="button"
                            className="btn small ghost"
                            title="Next match"
                            disabled={matchCount === 0}
                            onClick={() => runFind('next')}
                        >
                            ↓
                        </button>
                        <input
                            type="text"
                            placeholder="Replace"
                            value={replaceText}
                            onChange={(e) => setReplaceText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleReplaceOne();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    closeSearch();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="btn small"
                            disabled={matchCount === 0}
                            onClick={handleReplaceOne}
                        >
                            Replace
                        </button>
                        <button
                            type="button"
                            className="btn small"
                            disabled={matchCount === 0}
                            onClick={handleReplaceAll}
                        >
                            Replace all
                        </button>
                        <button
                            type="button"
                            className="btn small ghost"
                            title="Close"
                            aria-label="Close find & replace"
                            onClick={closeSearch}
                        >
                            ×
                        </button>
                    </div>
                )}
            </div>
        );
    },
);
