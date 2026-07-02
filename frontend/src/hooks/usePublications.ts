import { useCallback, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import type { Publication, PublishResult, Target } from '../../../shared/types';
import type { ValidationIssue } from './useValidation';
import type { MarkdownEditorHandle } from '../components/MarkdownEditor';
import type { ImageItem } from '../components/ImageUploader';

interface PublishParams {
    editorRef: RefObject<MarkdownEditorHandle>;
    targets: Target[];
    images: ImageItem[];
    parseImageUrls: () => string[];
    title: string;
    validationIssues: ValidationIssue[];
    ensureDraftForPublish: () => Promise<string>;
}

interface UpdatePublishedParams {
    editorRef: RefObject<MarkdownEditorHandle>;
    title: string;
    parseImageUrls: () => string[];
    validationIssues: ValidationIssue[];
}

/** Owns publish/update/delete for the currently open draft's publication(s), plus their state. */
export function usePublications() {
    const toast = useToast();
    const [publications, setPublications] = useState<Publication[]>([]);
    const [publishing, setPublishing] = useState(false);
    const [highlightedPublicationId, setHighlightedPublicationId] = useState<
        string | null
    >(null);
    const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    const clearHighlight = useCallback(() => {
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
        setHighlightedPublicationId(null);
    }, []);

    const flashHighlight = useCallback((id: string) => {
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        setHighlightedPublicationId(id);
        highlightTimeoutRef.current = setTimeout(() => {
            setHighlightedPublicationId(null);
            highlightTimeoutRef.current = null;
        }, 2200);
    }, []);

    const loadPublications = useCallback(async (draftId: string) => {
        const { publications } = await api<{ publications: Publication[] }>(
            `/api/publications?draftId=${encodeURIComponent(draftId)}`,
        );
        setPublications(publications);
    }, []);

    const reset = useCallback(() => {
        setPublications([]);
        clearHighlight();
    }, [clearHighlight]);

    const publish = useCallback(
        async (params: PublishParams) => {
            if (!params.targets.length) {
                return toast('Select at least one channel', 'warn');
            }
            if (params.validationIssues.length) {
                return toast(params.validationIssues[0].message, 'error');
            }
            const markdown = params.editorRef.current?.getMarkdown() ?? '';
            const imageIds = params.images.map((i) => i.id);
            if (
                !markdown.trim() &&
                !imageIds.length &&
                !params.parseImageUrls().length
            )
                return toast('Write something or add an image first', 'warn');
            if (
                params.targets.length > 5 &&
                !confirm(`Publish to ${params.targets.length} channels?`)
            )
                return;

            setPublishing(true);
            try {
                const savedDraftId = await params.ensureDraftForPublish();
                const { results, publication } = await api<{
                    results: PublishResult[];
                    publication: Publication | null;
                }>('/api/publish', {
                    method: 'POST',
                    body: {
                        draftId: savedDraftId,
                        title: params.title.trim() || 'Untitled',
                        markdown,
                        imageUrls: params.parseImageUrls(),
                        imageIds,
                        targets: params.targets,
                    },
                });
                await loadPublications(savedDraftId);
                if (publication) flashHighlight(publication.id);
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
        },
        [toast, loadPublications, flashHighlight],
    );

    const updatePublished = useCallback(
        async (publication: Publication, params: UpdatePublishedParams) => {
            if (params.validationIssues.length) {
                return toast(params.validationIssues[0].message, 'error');
            }
            const markdown = params.editorRef.current?.getMarkdown() ?? '';
            if (!markdown.trim() && !params.parseImageUrls().length) {
                return toast('Write something first', 'warn');
            }

            setPublishing(true);
            try {
                const { results, publication: updated } = await api<{
                    results: PublishResult[];
                    publication: Publication;
                }>(`/api/publications/${publication.id}/update`, {
                    method: 'POST',
                    body: {
                        title: params.title.trim() || 'Untitled',
                        markdown,
                        imageUrls: params.parseImageUrls(),
                    },
                });
                setPublications((cur) => [
                    updated,
                    ...cur.filter((p) => p.id !== updated.id),
                ]);
                flashHighlight(updated.id);
                const okCount = results.filter((r) => r.ok).length;
                toast(
                    `Updated ${okCount}/${results.length} published messages`,
                    okCount === results.length ? 'success' : 'warn',
                );
            } catch (err: any) {
                toast(err.message, 'error');
            } finally {
                setPublishing(false);
            }
        },
        [toast, flashHighlight],
    );

    const deletePublished = useCallback(
        async (publication: Publication) => {
            if (!confirm('Delete this publication from all channels?')) return;
            setPublishing(true);
            try {
                const { results, deleted } = await api<{
                    results: PublishResult[];
                    deleted: boolean;
                }>(`/api/publications/${publication.id}/delete`, {
                    method: 'POST',
                });
                if (deleted) {
                    setPublications((cur) =>
                        cur.filter((p) => p.id !== publication.id),
                    );
                }
                const okCount = results.filter((r) => r.ok).length;
                toast(
                    `Deleted ${okCount}/${results.length} published messages`,
                    okCount === results.length ? 'success' : 'warn',
                );
            } catch (err: any) {
                toast(err.message, 'error');
            } finally {
                setPublishing(false);
            }
        },
        [toast],
    );

    return {
        publications,
        publishing,
        highlightedPublicationId,
        clearHighlight,
        loadPublications,
        reset,
        publish,
        updatePublished,
        deletePublished,
    };
}
