import { describe, expect, test } from 'bun:test';
import { validateMarkdown, previewContent } from './validation';

describe('validateMarkdown', () => {
    test('returns ok with no issues for clean markdown', () => {
        const result = validateMarkdown('**bold** and _italic_ text');
        expect(result.ok).toBe(true);
        expect(result.issues).toEqual([]);
    });

    test('reports a split-tag issue with line/excerpt context when a bold span is hard-cut across chunks', () => {
        // A single 5000-char "word" wrapped in ** forces the word-boundary hard-cut in
        // chunk.ts to land inside the bold span's content, splitting the <b>...</b> pair
        // across two independently-validated chunks.
        const markdown = '**' + 'x'.repeat(5000) + '**';
        const result = validateMarkdown(markdown);
        expect(result.ok).toBe(false);
        expect(result.issues).toHaveLength(2);

        const [opening, closing] = result.issues;
        expect(opening.platform).toBe('telegram');
        expect(opening.chunk).toBe(1);
        expect(opening.tag).toBe('b');
        expect(opening.message).toBe('Opening tag <b> is not closed');
        expect(opening.line).toBe(1);
        expect(opening.excerpt).toBeTruthy();

        expect(closing.chunk).toBe(2);
        expect(closing.tag).toBe('b');
        expect(closing.message).toBe(
            'Closing tag </b> has no matching opening tag',
        );
    });

    test('numbers chunks starting at 1 and increments across multiple chunks', () => {
        const markdown = '**' + 'x'.repeat(5000) + '**';
        const result = validateMarkdown(markdown);
        const chunkNumbers = result.issues.map((i) => i.chunk);
        expect(chunkNumbers).toEqual([1, 2]);
    });
});

describe('previewContent', () => {
    test('converts markdown to both telegram HTML and discord markdown', () => {
        const result = previewContent('**hello** world');
        expect(result.telegramHtml).toBe('<b>hello</b> world');
        expect(result.discord).toBe('**hello** world');
    });
});
