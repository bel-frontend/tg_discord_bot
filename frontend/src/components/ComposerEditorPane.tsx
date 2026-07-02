import type { RefObject } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type {
    ChannelOption,
    PlatformMeta,
    Publication,
} from '../../../shared/types';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { PreviewPanel } from './PreviewPanel';
import { PublishedTab } from './PublishedTab';
import type { ValidationIssue } from '../hooks/useValidation';

interface Props {
    editorRef: RefObject<MarkdownEditorHandle>;
    theme: 'dark' | 'light';
    title: string;
    onTitleChange: (value: string) => void;
    editorTab: 'edit' | 'preview' | 'published';
    onEditTab: () => void;
    onPreviewTab: () => void;
    onPublishedTab: () => void;
    fullscreen: boolean;
    onToggleFullscreen: () => void;
    markdown: string;
    onEditorChange: () => void;
    validationIssues: ValidationIssue[];
    saveStatus: string;
    charCount: number;
    publications: Publication[];
    channels: ChannelOption[];
    platforms: PlatformMeta[];
    publishing: boolean;
    highlightedPublicationId: string | null;
    onUpdatePublished: (publication: Publication) => void;
    onDeletePublished: (publication: Publication) => void;
}

export function ComposerEditorPane({
    editorRef,
    theme,
    title,
    onTitleChange,
    editorTab,
    onEditTab,
    onPreviewTab,
    onPublishedTab,
    fullscreen,
    onToggleFullscreen,
    markdown,
    onEditorChange,
    validationIssues,
    saveStatus,
    charCount,
    publications,
    channels,
    platforms,
    publishing,
    highlightedPublicationId,
    onUpdatePublished,
    onDeletePublished,
}: Props) {
    const platformName = (id: string) =>
        platforms.find((p) => p.id === id)?.name ?? id;
    const limitLabels = platforms
        .filter((p) => p.charLimit)
        .map((p) => `${p.icon ?? p.name} ≤${p.charLimit}`)
        .join(' · ');
    const knownLimits = platforms
        .map((p) => p.charLimit)
        .filter((limit): limit is number => Boolean(limit));
    const maxKnownLimit = knownLimits.length ? Math.max(...knownLimits) : null;
    const FullscreenIcon = fullscreen ? Minimize2 : Maximize2;

    return (
        <section className={`editor-pane ${fullscreen ? 'fullscreen' : ''}`}>
            <input
                className="title-input"
                type="text"
                placeholder="Post title…"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
            />
            <div className="editor-tabs-row">
                <div className="editor-tabs">
                    <button
                        type="button"
                        className={`editor-tab ${
                            editorTab === 'edit' ? 'active' : ''
                        }`}
                        onClick={onEditTab}
                    >
                        Edit
                    </button>
                    <button
                        type="button"
                        className={`editor-tab ${
                            editorTab === 'preview' ? 'active' : ''
                        }`}
                        onClick={onPreviewTab}
                    >
                        Preview
                    </button>
                    <button
                        type="button"
                        className={`editor-tab ${
                            editorTab === 'published' ? 'active' : ''
                        }`}
                        onClick={onPublishedTab}
                    >
                        Update
                        {publications.length > 0 &&
                            ` (${publications.length})`}
                    </button>
                </div>
                <button
                    type="button"
                    className="btn ghost icon-btn"
                    title={fullscreen ? 'Collapse' : 'Expand'}
                    aria-label={fullscreen ? 'Collapse editor' : 'Expand editor'}
                    onClick={onToggleFullscreen}
                >
                    <FullscreenIcon size={18} strokeWidth={2.2} />
                </button>
            </div>
            <div
                className={`editor-tab-body ${
                    editorTab === 'published' ? 'with-update-panel' : ''
                }`}
            >
                <div
                    className="editor-tab-pane"
                    hidden={editorTab === 'preview'}
                >
                    <MarkdownEditor
                        ref={editorRef}
                        theme={theme}
                        onChange={onEditorChange}
                    />
                </div>
                {editorTab === 'preview' && (
                    <PreviewPanel markdown={markdown} platforms={platforms} />
                )}
                {editorTab === 'published' && (
                    <div className="update-panel">
                        <PublishedTab
                            publications={publications}
                            channels={channels}
                            platforms={platforms}
                            publishing={publishing}
                            highlightedPublicationId={highlightedPublicationId}
                            onUpdate={onUpdatePublished}
                            onDelete={onDeletePublished}
                        />
                    </div>
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
                            onEditTab();
                            requestAnimationFrame(() => {
                                editorRef.current?.focusLine(line);
                            });
                        }
                    }}
                >
                    <strong>
                        {platformName(validationIssues[0].platform)}{' '}
                        formatting problem
                    </strong>
                    <span>
                        Chunk {validationIssues[0].chunk}:{' '}
                        {validationIssues[0].message}
                    </span>
                    {validationIssues[0].line && (
                        <span>
                            Likely source: line {validationIssues[0].line}
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
                        maxKnownLimit !== null && charCount > maxKnownLimit
                            ? 'warn'
                            : ''
                    }`}
                >
                    {charCount} chars
                    {limitLabels && ` · ${limitLabels}`}
                </span>
            </div>
        </section>
    );
}
