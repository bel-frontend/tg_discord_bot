// @toast-ui/editor ships types under /types but doesn't map them via package.json
// "exports", so bundler-mode tsc can't resolve them. Declare the small surface we use.
declare module '@toast-ui/editor' {
    interface EditorOptions {
        el: HTMLElement;
        height?: string;
        initialEditType?: 'markdown' | 'wysiwyg';
        previewStyle?: 'tab' | 'vertical';
        usageStatistics?: boolean;
        theme?: string;
        initialValue?: string;
        toolbarItems?: string[][];
        events?: Record<string, (...args: any[]) => void>;
        [key: string]: any;
    }

    export default class Editor {
        constructor(options: EditorOptions);
        getMarkdown(): string;
        setMarkdown(markdown: string, cursorToEnd?: boolean): void;
        destroy(): void;
    }
}

declare module '@toast-ui/editor/dist/toastui-editor.css';
declare module '@toast-ui/editor/dist/theme/toastui-editor-dark.css';
