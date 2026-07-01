import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
} from 'react';
import Editor from '@toast-ui/editor';

export interface MarkdownEditorHandle {
    getMarkdown: () => string;
    setMarkdown: (md: string) => void;
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
        const onChangeRef = useRef(onChange);
        onChangeRef.current = onChange;

        useImperativeHandle(ref, () => ({
            getMarkdown: () => editor.current?.getMarkdown() ?? '',
            setMarkdown: (md: string) => editor.current?.setMarkdown(md ?? ''),
        }));

        // Recreate the editor when the theme changes so its styling matches.
        useEffect(() => {
            if (!holder.current) return;
            const previous = editor.current?.getMarkdown() ?? '';

            editor.current = new Editor({
                el: holder.current,
                height: '100%',
                initialEditType: 'markdown',
                previewStyle: 'vertical',
                usageStatistics: false,
                theme: theme === 'dark' ? 'dark' : 'default',
                initialValue: previous,
                toolbarItems: [
                    ['heading', 'bold', 'italic', 'strike'],
                    ['hr', 'quote'],
                    ['ul', 'ol', 'task'],
                    ['table', 'link'],
                    ['code', 'codeblock'],
                ],
                events: {
                    change: () => onChangeRef.current(),
                },
            });

            return () => {
                editor.current?.destroy();
                editor.current = null;
            };
        }, [theme]);

        return <div className="editor-holder" ref={holder} />;
    },
);
