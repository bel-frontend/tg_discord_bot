import { describe, expect, test } from 'bun:test';
import { markdownToXPreviewHtml, markdownToXText } from './markdown';

describe('markdownToXText', () => {
    test('flattens headings, emphasis and lists to plain text', () => {
        const markdown = [
            '# Title',
            '',
            'Some **bold** and *italic* text.',
            '',
            '- first',
            '- second',
        ].join('\n');
        expect(markdownToXText(markdown)).toBe(
            'Title\n\nSome bold and italic text.\n\n- first\n- second',
        );
    });

    test('renders links as "text URL"', () => {
        expect(markdownToXText('See [the docs](https://example.com/docs).')).toBe(
            'See the docs https://example.com/docs.',
        );
    });

    test('keeps a bare autolink as just the URL', () => {
        expect(markdownToXText('<https://example.com>')).toBe(
            'https://example.com',
        );
    });

    test('collapses blockquotes and code blocks to their text', () => {
        expect(markdownToXText('> quoted\n\n```\ncode here\n```')).toBe(
            'quoted\n\ncode here',
        );
    });

    test('collapses runs of 3+ newlines to a single blank line', () => {
        expect(markdownToXText('a\n\n\n\nb')).toBe('a\n\nb');
    });
});

describe('markdownToXPreviewHtml', () => {
    test('escapes HTML and converts newlines to <br/>', () => {
        expect(markdownToXPreviewHtml('a <b> & c\n\nnext')).toBe(
            'a &lt;b&gt; &amp; c<br/><br/>next',
        );
    });
});
