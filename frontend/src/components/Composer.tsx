import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import type { Draft, Publication, User } from '../../../shared/types';
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
    const [editorTab, setEditorTab] = useState<
        'edit' | 'preview' | 'published'
    >('edit');
    const [focusMode, setFocusMode] = useState(
        localStorage.getItem('composer.focusMode') === 'true',
    );
    const [editorFullscreen, setEditorFullscreen] = useState(
        localStorage.getItem('composer.editorFullscreen') === 'true',
    );

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
    const { validationIssues } = useValidation(draftEditor.markdown);
    const publications = usePublications();

    // Load channels + drafts once.
    useEffect(() => {
        (async () => {
            try {
                await Promise.all([loadChannels(), loadDrafts()]);
            } catch (err: any) {
                toast(err.message, 'error');
            }
        })();
    }, [toast, loadChannels, loadDrafts]);

    function handleEditorChange() {
        draftEditor.handleEditorContentChange();
        autosave.scheduleSave();
    }

    async function openDraft(id: string) {
        try {
            const { draft } = await api<{ draft: Draft }>(`/api/drafts/${id}`);
            draftEditor.revokeImages();
            draftEditor.setImages([]);
            autosave.withSuppressed(() => draftEditor.applyDraft(draft));
            // Restore image thumbnails (fetched from the server, may take a moment).
            const previews = await loadImagePreviews(draft.imageIds || []);
            draftEditor.setImages(previews);
            publications.clearHighlight();
            await publications.loadPublications(draft.id);
        } catch (err: any) {
            toast(err.message, 'error');
        }
    }

    function newDraft() {
        draftEditor.revokeImages();
        draftEditor.setImages([]);
        autosave.withSuppressed(() => draftEditor.resetForNewDraft());
        publications.reset();
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
        });
    }

    function updatePublished(publication: Publication) {
        publications.updatePublished(publication, {
            editorRef,
            title: draftEditor.title,
            parseImageUrls: draftEditor.parseImageUrls,
            validationIssues,
        });
    }

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">✦</span>
                    <span className="brand-name">Composer</span>
                </div>
                <div className="topbar-right">
                    <button
                        className={`btn ghost ${focusMode ? 'active' : ''}`}
                        title="Toggle focus mode (hide side panels)"
                        onClick={() => setFocusMode((f) => !f)}
                    >
                        ⛶
                    </button>
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

            <main className={`layout ${focusMode ? 'focus-mode' : ''}`}>
                {!focusMode && (
                    <DraftsRail
                        drafts={drafts}
                        activeId={draftEditor.draftId}
                        onNew={newDraft}
                        onOpen={openDraft}
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
                        publications={publications.publications}
                        publishing={publications.publishing}
                        onSaveDraft={() => draftEditor.saveDraft(false)}
                        onPublish={publish}
                    />
                )}
            </main>
        </div>
    );
}
