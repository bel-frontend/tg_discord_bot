import { useEffect, useRef, useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { api, fetchPublication, schedulePublication } from '../api';
import { useToast } from '../toast';
import type { Draft, Publication } from '../../../shared/types';
import { type MarkdownEditorHandle } from './MarkdownEditor';
import { DraftsRail } from './DraftsRail';
import { ComposerEditorPane } from './ComposerEditorPane';
import { ComposerSidebar } from './ComposerSidebar';
import { useChannels } from '../hooks/useChannels';
import { useDrafts } from '../hooks/useDrafts';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { useAutosave } from '../hooks/useAutosave';
import { useValidation } from '../hooks/useValidation';
import { usePublications } from '../hooks/usePublications';
import { loadImagePreviews } from '../hooks/useImagePreviews';
import { usePlatforms } from '../hooks/usePlatforms';

interface Props {
    theme: 'dark' | 'light';
    initialEditId?: string;
    initialPublicationId?: string;
    onOpenDraftRoute?: (draftId: string, publicationId?: string) => void;
    onNewDraftRoute?: () => void;
}

export function Composer({
    theme,
    initialEditId,
    initialPublicationId,
    onOpenDraftRoute,
    onNewDraftRoute,
}: Props) {
    const toast = useToast();
    const editorRef = useRef<MarkdownEditorHandle>(null);
    const draftLoadSeq = useRef(0);
    const openedRouteDraftRef = useRef('');
    const [editorTab, setEditorTab] = useState<
        'edit' | 'preview' | 'published'
    >('edit');
    const [focusMode, setFocusMode] = useState(
        localStorage.getItem('composer.focusMode') === 'true',
    );
    const [editorFullscreen, setEditorFullscreen] = useState(
        localStorage.getItem('composer.editorFullscreen') === 'true',
    );
    const [scheduling, setScheduling] = useState(false);

    useEffect(() => {
        localStorage.setItem('composer.focusMode', String(focusMode));
    }, [focusMode]);
    useEffect(() => {
        localStorage.setItem(
            'composer.editorFullscreen',
            String(editorFullscreen),
        );
    }, [editorFullscreen]);

    // Let Escape collapse fullscreen, same as clicking the backdrop.
    useEffect(() => {
        if (!editorFullscreen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setEditorFullscreen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editorFullscreen]);

    const { channels, loadChannels } = useChannels();
    const { platforms, loadPlatforms } = usePlatforms();
    const {
        drafts,
        setDrafts,
        loadDrafts,
        deleteDraft: deleteDraftFromList,
    } = useDrafts();
    const draftEditor = useDraftEditor(editorRef, setDrafts);
    const autosave = useAutosave(
        draftEditor.collect,
        draftEditor.saveDraft,
        draftEditor.setSaveStatus,
    );
    const { validationIssues } = useValidation(
        draftEditor.markdown,
        draftEditor.targets,
    );
    const publications = usePublications();

    // Load platform metadata, channels, and drafts once.
    useEffect(() => {
        (async () => {
            try {
                await Promise.all([
                    loadPlatforms(),
                    loadChannels(),
                    loadDrafts(),
                ]);
            } catch (err: any) {
                toast(err.message, 'error');
            }
        })();
    }, [toast, loadPlatforms, loadChannels, loadDrafts]);

    function handleEditorChange() {
        draftEditor.handleEditorContentChange();
        autosave.scheduleSave();
    }

    async function loadDraft(id: string, highlightPublicationId?: string) {
        const seq = ++draftLoadSeq.current;
        const { draft } = await api<{ draft: Draft }>(`/api/drafts/${id}`);
        if (seq !== draftLoadSeq.current) return;
        draftEditor.revokeImages();
        draftEditor.setImages([]);
        autosave.withSuppressed(() => draftEditor.applyDraft(draft));
        // Restore image thumbnails (fetched from the server, may take a moment).
        const previews = await loadImagePreviews(draft.imageIds || []);
        if (seq !== draftLoadSeq.current) return;
        draftEditor.setImages(previews);
        publications.clearHighlight();
        await publications.loadPublications(draft.id);
        if (highlightPublicationId) {
            publications.highlightPublication(highlightPublicationId);
        }
    }

    async function openDraft(id: string, highlightPublicationId?: string) {
        try {
            await loadDraft(id, highlightPublicationId);
        } catch (err: any) {
            toast(err.message, 'error');
        }
    }

    async function openEditTarget(id: string, highlightPublicationId?: string) {
        try {
            await loadDraft(id, highlightPublicationId);
        } catch (err: any) {
            if (err?.message !== 'Not found') {
                toast(err.message, 'error');
                return;
            }

            try {
                const publication = await fetchPublication(id);
                setEditorTab('published');
                await loadDraft(publication.draftId, publication.id);
            } catch (publicationErr: any) {
                toast(publicationErr.message, 'error');
            }
        }
    }

    function newDraft() {
        draftLoadSeq.current++;
        draftEditor.revokeImages();
        draftEditor.setImages([]);
        autosave.withSuppressed(() => draftEditor.resetForNewDraft());
        publications.reset();
        openedRouteDraftRef.current = '';
        onNewDraftRoute?.();
    }

    function openDraftFromRail(id: string) {
        openedRouteDraftRef.current = `${id}:`;
        onOpenDraftRoute?.(id);
        openDraft(id);
    }

    async function deleteDraft(id: string) {
        const deleted = await deleteDraftFromList(id);
        if (deleted && draftEditor.draftId === id) newDraft();
    }

    function publish() {
        publications.publish({
            editorRef,
            targets: draftEditor.targets,
            images: draftEditor.images,
            parseImageUrls: draftEditor.parseImageUrls,
            title: draftEditor.title,
            validationIssues,
            ensureDraftForPublish: draftEditor.ensureDraftForPublish,
            silent: draftEditor.silent,
        });
    }

    async function schedule(scheduledAt: string) {
        if (!draftEditor.targets.length) {
            return toast('Select at least one channel', 'warn');
        }
        if (validationIssues.length) {
            return toast(validationIssues[0].message, 'error');
        }
        draftEditor.handleEditorContentChange();
        const markdown = editorRef.current?.getMarkdown() ?? '';
        if (
            !markdown.trim() &&
            !draftEditor.images.length &&
            !draftEditor.parseImageUrls().length
        ) {
            return toast('Write something or add an image first', 'warn');
        }

        setScheduling(true);
        try {
            const draftId = await draftEditor.ensureDraftSaved();
            await schedulePublication(draftId, scheduledAt);
            toast('Publication scheduled', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setScheduling(false);
        }
    }

    function updatePublished(publication: Publication) {
        publications.updatePublished(publication, {
            editorRef,
            title: draftEditor.title,
            parseImageUrls: draftEditor.parseImageUrls,
            validationIssues,
        });
    }

    useEffect(() => {
        if (!initialEditId) return;
        const key = `${initialEditId}:${initialPublicationId ?? ''}`;
        if (openedRouteDraftRef.current === key) return;
        openedRouteDraftRef.current = key;
        if (initialPublicationId) setEditorTab('published');
        openEditTarget(initialEditId, initialPublicationId);
    }, [initialEditId, initialPublicationId]);

    const SidePanelsIcon = focusMode ? PanelRightOpen : PanelRightClose;

    return (
        <main className={`layout ${focusMode ? 'focus-mode' : ''}`}>
                <button
                    type="button"
                    className={`side-panels-toggle ${
                        focusMode ? 'active' : ''
                    }`}
                    title={
                        focusMode ? 'Show side panels' : 'Hide side panels'
                    }
                    aria-label={
                        focusMode ? 'Show side panels' : 'Hide side panels'
                    }
                    onClick={() => setFocusMode((f) => !f)}
                >
                    <SidePanelsIcon size={18} strokeWidth={2.2} />
                </button>

                {!focusMode && (
                    <DraftsRail
                        drafts={drafts}
                        activeId={draftEditor.draftId}
                        onNew={newDraft}
                        onOpen={openDraftFromRail}
                        onDelete={deleteDraft}
                    />
                )}

                {editorFullscreen && (
                    <div
                        className="fullscreen-backdrop"
                        onClick={() => setEditorFullscreen(false)}
                    />
                )}

                <ComposerEditorPane
                    editorRef={editorRef}
                    theme={theme}
                    title={draftEditor.title}
                    onTitleChange={(value) => {
                        draftEditor.setTitle(value);
                        autosave.scheduleSave();
                    }}
                    editorTab={editorTab}
                    onEditTab={() => setEditorTab('edit')}
                    onPreviewTab={() => {
                        draftEditor.handleEditorContentChange();
                        setEditorTab('preview');
                    }}
                    onPublishedTab={() => setEditorTab('published')}
                    fullscreen={editorFullscreen}
                    onToggleFullscreen={() =>
                        setEditorFullscreen((f) => !f)
                    }
                    markdown={draftEditor.markdown}
                    onEditorChange={handleEditorChange}
                    validationIssues={validationIssues}
                    saveStatus={draftEditor.saveStatus}
                    charCount={draftEditor.charCount}
                    publications={publications.publications}
                    channels={channels}
                    platforms={platforms}
                    publishing={publications.publishing}
                    highlightedPublicationId={
                        publications.highlightedPublicationId
                    }
                    onUpdatePublished={updatePublished}
                    onDeletePublished={publications.deletePublished}
                />

                {!focusMode && (
                    <ComposerSidebar
                        channels={channels}
                        platforms={platforms}
                        targets={draftEditor.targets}
                        onTargetsChange={(next) => {
                            draftEditor.setTargets(next);
                            autosave.scheduleSave();
                        }}
                        images={draftEditor.images}
                        onImagesChange={(next) => {
                            draftEditor.setImages(next);
                            autosave.scheduleSave();
                        }}
                        imageUrls={draftEditor.imageUrls}
                        onImageUrlsChange={(value) => {
                            draftEditor.setImageUrls(value);
                            autosave.scheduleSave();
                        }}
                        silent={draftEditor.silent}
                        onSilentChange={(value) => {
                            draftEditor.setSilent(value);
                            autosave.scheduleSave();
                        }}
                        publications={publications.publications}
                        publishing={publications.publishing}
                        scheduling={scheduling}
                        onSaveDraft={() => draftEditor.saveDraft(false)}
                        onPublish={publish}
                        onSchedule={schedule}
                    />
                )}
        </main>
    );
}
