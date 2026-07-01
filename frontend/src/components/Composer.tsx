import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import type {
    ChannelOption,
    Draft,
    PublishResult,
    Target,
    User,
} from '../types';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { ChannelPicker, platformIcon } from './ChannelPicker';
import { DraftsRail } from './DraftsRail';

interface Props {
    user: User;
    theme: 'dark' | 'light';
    onToggleTheme: () => void;
    onLogout: () => void;
}

export function Composer({ user, theme, onToggleTheme, onLogout }: Props) {
    const toast = useToast();
    const editorRef = useRef<MarkdownEditorHandle>(null);

    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [channels, setChannels] = useState<ChannelOption[]>([]);
    const [draftId, setDraftId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [imageUrls, setImageUrls] = useState('');
    const [targets, setTargets] = useState<Target[]>([]);
    const [saveStatus, setSaveStatus] = useState('');
    const [charCount, setCharCount] = useState(0);
    const [results, setResults] = useState<PublishResult[] | null>(null);
    const [publishing, setPublishing] = useState(false);

    // Mirror the latest state into refs so the debounced save reads fresh values.
    const draftIdRef = useRef(draftId);
    const titleRef = useRef(title);
    const imageUrlsRef = useRef(imageUrls);
    const targetsRef = useRef(targets);
    draftIdRef.current = draftId;
    titleRef.current = title;
    imageUrlsRef.current = imageUrls;
    targetsRef.current = targets;

    const suppressSave = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const parseImageUrls = () =>
        imageUrlsRef.current
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

    const collect = useCallback(
        () => ({
            title: titleRef.current.trim() || 'Untitled',
            markdown: editorRef.current?.getMarkdown() ?? '',
            imageUrls: parseImageUrls(),
            targets: targetsRef.current,
        }),
        [],
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
        [collect, toast],
    );

    const scheduleSave = useCallback(() => {
        if (suppressSave.current) return;
        const data = collect();
        if (!data.markdown.trim() && data.title === 'Untitled') return;
        setSaveStatus('Saving…');
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => saveDraft(true), 1000);
    }, [collect, saveDraft]);

    const handleEditorChange = useCallback(() => {
        setCharCount(editorRef.current?.getMarkdown().length ?? 0);
        scheduleSave();
    }, [scheduleSave]);

    // Load channels + drafts once.
    useEffect(() => {
        (async () => {
            try {
                const [{ channels }, { drafts }] = await Promise.all([
                    api<{ channels: ChannelOption[] }>('/api/channels'),
                    api<{ drafts: Draft[] }>('/api/drafts'),
                ]);
                setChannels(channels);
                setDrafts(drafts);
            } catch (err: any) {
                toast(err.message, 'error');
            }
        })();
    }, [toast]);

    function withSuppressedSave(fn: () => void) {
        suppressSave.current = true;
        fn();
        // Release after the editor's change event has flushed.
        setTimeout(() => {
            suppressSave.current = false;
        }, 50);
    }

    async function openDraft(id: string) {
        try {
            const { draft } = await api<{ draft: Draft }>(`/api/drafts/${id}`);
            withSuppressedSave(() => {
                setDraftId(draft.id);
                setTitle(draft.title === 'Untitled' ? '' : draft.title);
                setImageUrls((draft.imageUrls || []).join(', '));
                setTargets(draft.targets || []);
                editorRef.current?.setMarkdown(draft.markdown || '');
                setCharCount((draft.markdown || '').length);
                setSaveStatus('');
            });
        } catch (err: any) {
            toast(err.message, 'error');
        }
    }

    function newDraft() {
        withSuppressedSave(() => {
            setDraftId(null);
            setTitle('');
            setImageUrls('');
            setTargets([]);
            editorRef.current?.setMarkdown('');
            setCharCount(0);
            setSaveStatus('');
        });
    }

    async function deleteDraft(id: string) {
        if (!confirm('Delete this draft?')) return;
        try {
            await api(`/api/drafts/${id}`, { method: 'DELETE' });
            setDrafts((cur) => cur.filter((d) => d.id !== id));
            if (draftId === id) newDraft();
            toast('Draft deleted', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        }
    }

    async function publish() {
        if (!targets.length) return toast('Select at least one channel', 'warn');
        const markdown = editorRef.current?.getMarkdown() ?? '';
        if (!markdown.trim()) return toast('Write something first', 'warn');
        if (
            targets.length > 5 &&
            !confirm(`Publish to ${targets.length} channels?`)
        )
            return;

        setPublishing(true);
        try {
            const { results } = await api<{ results: PublishResult[] }>(
                '/api/publish',
                {
                    method: 'POST',
                    body: { markdown, imageUrls: parseImageUrls(), targets },
                },
            );
            setResults(results);
            const okCount = results.filter((r) => r.ok).length;
            toast(
                `Published to ${okCount}/${results.length} channels`,
                okCount === results.length ? 'success' : 'warn',
            );
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setPublishing(false);
        }
    }

    const channelName = (r: PublishResult) =>
        channels.find((c) => c.platform === r.platform && c.id === r.channelId)
            ?.name || r.channelId;

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">✦</span>
                    <span className="brand-name">Composer</span>
                </div>
                <div className="topbar-right">
                    <button
                        className="btn ghost"
                        title="Toggle theme"
                        onClick={onToggleTheme}
                    >
                        ◐
                    </button>
                    <span className="user-email">{user.email}</span>
                    <button className="btn ghost" onClick={onLogout}>
                        Log out
                    </button>
                </div>
            </header>

            <main className="layout">
                <DraftsRail
                    drafts={drafts}
                    activeId={draftId}
                    onNew={newDraft}
                    onOpen={openDraft}
                    onDelete={deleteDraft}
                />

                <section className="editor-pane">
                    <input
                        className="title-input"
                        type="text"
                        placeholder="Post title…"
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value);
                            scheduleSave();
                        }}
                    />
                    <MarkdownEditor
                        ref={editorRef}
                        theme={theme}
                        onChange={handleEditorChange}
                    />
                    <div className="editor-foot">
                        <span className="save-status">{saveStatus}</span>
                        <span
                            className={`char-count ${
                                charCount > 4096 ? 'warn' : ''
                            }`}
                        >
                            {charCount} chars · TG ≤4096 · Discord ≤2000
                        </span>
                    </div>
                </section>

                <aside className="sidebar">
                    <h3 className="side-title">Publish to</h3>
                    <ChannelPicker
                        channels={channels}
                        selected={targets}
                        onChange={(next) => {
                            setTargets(next);
                            scheduleSave();
                        }}
                    />

                    <label className="field">
                        Image URLs (comma-separated)
                        <input
                            type="text"
                            placeholder="https://…"
                            value={imageUrls}
                            onChange={(e) => {
                                setImageUrls(e.target.value);
                                scheduleSave();
                            }}
                        />
                    </label>

                    <div className="actions">
                        <button
                            className="btn"
                            onClick={() => saveDraft(false)}
                        >
                            Save draft
                        </button>
                        <button
                            className={`btn primary ${
                                publishing ? 'loading' : ''
                            }`}
                            onClick={publish}
                            disabled={publishing || targets.length === 0}
                        >
                            Publish
                            {targets.length > 0 && (
                                <span className="count"> ({targets.length})</span>
                            )}
                        </button>
                    </div>

                    {results && (
                        <div className="results">
                            <h4>Results</h4>
                            {results.map((r, i) => (
                                <div
                                    key={i}
                                    className={`result-row ${
                                        r.ok ? 'ok' : 'fail'
                                    }`}
                                >
                                    <span className="badge">
                                        {r.ok ? '✓' : '✗'}
                                    </span>
                                    <span className="result-name">
                                        {platformIcon(r.platform)}{' '}
                                        {channelName(r)}
                                    </span>
                                    {!r.ok && (
                                        <span className="result-err">
                                            {r.error}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </aside>
            </main>
        </div>
    );
}
