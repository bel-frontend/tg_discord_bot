import type { RefObject } from 'react';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { PreviewPanel } from './PreviewPanel';
import type { ValidationIssue } from '../hooks/useValidation';

interface Props {
    editorRef: RefObject<MarkdownEditorHandle>;
    theme: 'dark' | 'light';
    title: string;
    onTitleChange: (value: string) => void;
    editorTab: 'edit' | 'preview';
    onEditTab: () => void;
    onPreviewTab: () => void;
    markdown: string;
    onEditorChange: () => void;
    validationIssues: ValidationIssue[];
    saveStatus: string;
    charCount: number;
}

export function ComposerEditorPane({
    editorRef,
    theme,
    title,
    onTitleChange,
    editorTab,
    onEditTab,
    onPreviewTab,
    markdown,
    onEditorChange,
    validationIssues,
    saveStatus,
    charCount,
}: Props) {
    return (
        <section className="editor-pane">
            <input
                className="title-input"
                type="text"
                placeholder="Post title…"
                value={title}
                onChange={(e) => onTitleChange(e.target.value)}
            />
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
            </div>
            <div className="editor-tab-body">
                <div className="editor-tab-pane" hidden={editorTab !== 'edit'}>
                    <MarkdownEditor
                        ref={editorRef}
                        theme={theme}
                        onChange={onEditorChange}
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
                            onEditTab();
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
                    className={`char-count ${charCount > 4096 ? 'warn' : ''}`}
                >
                    {charCount} chars · TG ≤4096 · Discord ≤2000
                </span>
            </div>
        </section>
    );
}
