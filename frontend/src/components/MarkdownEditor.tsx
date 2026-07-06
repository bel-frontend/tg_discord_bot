import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import Editor from '@toast-ui/editor';
import { scrollEditorIntoView, useFindReplace } from '../hooks/useFindReplace';

export interface MarkdownEditorHandle {
    getMarkdown: () => string;
    setMarkdown: (md: string) => void;
    focusLine: (line: number) => void;
}

interface Props {
    theme: 'dark' | 'light';
    onChange: () => void;
}

// Wraps the vanilla Toast UI Editor so we don't depend on its (older) React binding.
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(
    ({ theme, onChange }, ref) => {
        const holder = useRef<HTMLDivElement>(null);
        const editor = useRef<Editor | null>(null);
        const pendingMarkdown = useRef<string | null>(null);
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;

        const search = useFindReplace(editor, holder, onChangeRef);

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
                scrollEditorIntoView(holder.current);
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
                                search.openSearch(),
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
                    search.openSearch();
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
                {search.searchOpen && (
                    <div className="editor-search-panel">
                        <input
                            ref={search.queryInputRef}
                            type="text"
                            placeholder="Find"
                            value={search.query}
                            onChange={(e) => search.handleQueryChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    search.runFind(e.shiftKey ? 'prev' : 'next');
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    search.closeSearch();
                                }
                            }}
                        />
                        <span className="match-count">
                            {search.query
                                ? search.matchCount > 0
                                    ? `${search.matchIndex + 1}/${search.matchCount}`
                                    : 'No results'
                                : ''}
                        </span>
                        <button
                            type="button"
                            className="btn small ghost"
                            title="Previous match"
                            disabled={search.matchCount === 0}
                            onClick={() => search.runFind('prev')}
                        >
                            ↑
                        </button>
                        <button
                            type="button"
                            className="btn small ghost"
                            title="Next match"
                            disabled={search.matchCount === 0}
                            onClick={() => search.runFind('next')}
                        >
                            ↓
                        </button>
                        <input
                            type="text"
                            placeholder="Replace"
                            value={search.replaceText}
                            onChange={(e) => search.setReplaceText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    search.handleReplaceOne();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    search.closeSearch();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="btn small"
                            disabled={search.matchCount === 0}
                            onClick={search.handleReplaceOne}
                        >
                            Replace
                        </button>
                        <button
                            type="button"
                            className="btn small"
                            disabled={search.matchCount === 0}
                            onClick={search.handleReplaceAll}
                        >
                            Replace all
                        </button>
                        <button
                            type="button"
                            className="btn small ghost"
                            title="Close"
                            aria-label="Close find & replace"
                            onClick={search.closeSearch}
                        >
                            ×
                        </button>
                    </div>
                )}
            </div>
        );
    },
);
