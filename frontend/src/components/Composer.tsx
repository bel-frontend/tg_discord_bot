import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fetchImageObjectUrl, validatePost } from '../api';
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
import { ImageUploader, type ImageItem } from './ImageUploader';
import { PreviewPanel } from './PreviewPanel';

interface Props {
    user: User;
    theme: 'dark' | 'light';
    onToggleTheme: () => void;
    onManageResources: () => void;
    onLogout: () => void;
}

export function Composer({
    user,
    theme,
    onToggleTheme,
    onManageResources,
    onLogout,
}: Props) {
    const toast = useToast();
    const editorRef = useRef<MarkdownEditorHandle>(null);

    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [channels, setChannels] = useState<ChannelOption[]>([]);
    const [draftId, setDraftId] = useState<string | null>(null);
    const [title, setTitle] = useState('');
    const [imageUrls, setImageUrls] = useState('');
    const [images, setImages] = useState<ImageItem[]>([]);
    const [targets, setTargets] = useState<Target[]>([]);
    const [saveStatus, setSaveStatus] = useState('');
    const [charCount, setCharCount] = useState(0);
    const [markdown, setMarkdown] = useState('');
    const [editorTab, setEditorTab] = useState<'edit' | 'preview'>('edit');
    const [results, setResults] = useState<PublishResult[] | null>(null);
    const [publishing, setPublishing] = useState(false);
    const [validationIssues, setValidationIssues] = useState<
        Array<{
            platform: string;
            chunk: number;
            message: string;
            line?: number;
            excerpt?: string;
            htmlContext?: string;
        }>
    >([]);

    // Mirror the latest state into refs so the debounced save reads fresh values.
    const draftIdRef = useRef(draftId);
    const titleRef = useRef(title);
    const imageUrlsRef = useRef(imageUrls);
    const imagesRef = useRef(images);
    const targetsRef = useRef(targets);
    draftIdRef.current = draftId;
    titleRef.current = title;
    imageUrlsRef.current = imageUrls;
    imagesRef.current = images;
    targetsRef.current = targets;

    const suppressSave = useRef(false);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const validateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            imageIds: imagesRef.current.map((i) => i.id),
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
        const markdown = editorRef.current?.getMarkdown() ?? '';
        setCharCount(markdown.length);
        setMarkdown(markdown);
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

    function revokeImages() {
        for (const img of imagesRef.current) URL.revokeObjectURL(img.previewUrl);
    }

    async function loadImagePreviews(ids: string[]): Promise<ImageItem[]> {
        const items = await Promise.all(
            ids.map(async (id) => {
                try {
                    return {
                        id,
                        filename: 'image',
                        previewUrl: await fetchImageObjectUrl(id),
                    };
                } catch {
                    return null;
                }
            }),
        );
        return items.filter((i): i is ImageItem => i !== null);
    }

    async function openDraft(id: string) {
        try {
            const { draft } = await api<{ draft: Draft }>(`/api/drafts/${id}`);
            revokeImages();
            setImages([]);
            withSuppressedSave(() => {
                setDraftId(draft.id);
                setTitle(draft.title === 'Untitled' ? '' : draft.title);
                setImageUrls((draft.imageUrls || []).join(', '));
                setTargets(draft.targets || []);
                editorRef.current?.setMarkdown(draft.markdown || '');
                setMarkdown(draft.markdown || '');
                setCharCount((draft.markdown || '').length);
                setSaveStatus('');
            });
            // Restore image thumbnails (fetched from the server, may take a moment).
            const previews = await loadImagePreviews(draft.imageIds || []);
            setImages(previews);
        } catch (err: any) {
            toast(err.message, 'error');
        }
    }

    function newDraft() {
        revokeImages();
        setImages([]);
        withSuppressedSave(() => {
            setDraftId(null);
            setTitle('');
            setImageUrls('');
            setTargets([]);
            editorRef.current?.setMarkdown('');
            setMarkdown('');
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
        if (validationIssues.length) {
            return toast(validationIssues[0].message, 'error');
        }
        const markdown = editorRef.current?.getMarkdown() ?? '';
        const imageIds = images.map((i) => i.id);
        if (!markdown.trim() && !imageIds.length && !parseImageUrls().length)
            return toast('Write something or add an image first', 'warn');
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
                    body: {
                        markdown,
                        imageUrls: parseImageUrls(),
                        imageIds,
                        targets,
                    },
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
                    <button className="btn ghost" onClick={onManageResources}>
                        Resources
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
                    <div className="editor-tabs">
                        <button
                            type="button"
                            className={`editor-tab ${
                                editorTab === 'edit' ? 'active' : ''
                            }`}
                            onClick={() => setEditorTab('edit')}
                        >
                            Edit
                        </button>
                        <button
                            type="button"
                            className={`editor-tab ${
                                editorTab === 'preview' ? 'active' : ''
                            }`}
                            onClick={() => {
                                setMarkdown(
                                    editorRef.current?.getMarkdown() ?? '',
                                );
                                setEditorTab('preview');
                            }}
                        >
                            Preview
                        </button>
                    </div>
                    <div className="editor-tab-body">
                        <div
                            className="editor-tab-pane"
                            hidden={editorTab !== 'edit'}
                        >
                            <MarkdownEditor
                                ref={editorRef}
                                theme={theme}
                                onChange={handleEditorChange}
                            />
                        </div>
                        {editorTab === 'preview' && (
                            <PreviewPanel markdown={markdown} />
                        )}
                    </div>
                    {validationIssues.length > 0 && (
                        <button
                            type="button"
                            className="validation-warning"
                            title="Jump to likely source line"
                            onClick={() => {
                                const line = validationIssues[0].line;
                                if (line) {
                                    setEditorTab('edit');
                                    requestAnimationFrame(() => {
                                        editorRef.current?.focusLine(line);
                                    });
                                }
                            }}
                        >
                            <strong>Telegram formatting problem</strong>
                            <span>
                                Chunk {validationIssues[0].chunk}:{' '}
                                {validationIssues[0].message}
                            </span>
                            {validationIssues[0].line && (
                                <span>
                                    Likely source: line{' '}
                                    {validationIssues[0].line}
                                </span>
                            )}
                            {validationIssues[0].excerpt && (
                                <code className="validation-excerpt">
                                    {validationIssues[0].excerpt}
                                </code>
                            )}
                        </button>
                    )}
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

                    <ImageUploader
                        images={images}
                        onChange={(next) => {
                            setImages(next);
                            scheduleSave();
                        }}
                    />

                    <label className="field">
                        or image URLs (comma-separated)
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
