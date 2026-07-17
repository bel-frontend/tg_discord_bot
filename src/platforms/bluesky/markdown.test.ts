import { describe, expect, test } from 'bun:test';
import {
    markdownToBlueskyPreviewHtml,
    markdownToBlueskyText,
} from './markdown';

describe('markdownToBlueskyText', () => {
    test('flattens headings, emphasis and lists to plain text', () => {
        const markdown = [
            '# Title',
            '',
            'Some **bold** and *italic* text.',
            '',
            '- first',
            '- second',
        ].join('\n');
        expect(markdownToBlueskyText(markdown)).toBe(
            'Title\n\nSome bold and italic text.\n\n- first\n- second',
        );
    });

    test('renders links as "text URL" so facet detection can pick up the URL', () => {
        expect(
            markdownToBlueskyText('See [the docs](https://example.com/docs).'),
        ).toBe('See the docs https://example.com/docs.');
    });

    test('keeps a bare autolink as just the URL', () => {
        expect(markdownToBlueskyText('<https://example.com>')).toBe(
            'https://example.com',
        );
    });

    test('collapses blockquotes and code blocks to their text', () => {
        expect(markdownToBlueskyText('> quoted\n\n```\ncode here\n```')).toBe(
            'quoted\n\ncode here',
        );
    });
});

describe('markdownToBlueskyPreviewHtml', () => {
    test('escapes HTML and converts newlines to <br/>', () => {
        expect(markdownToBlueskyPreviewHtml('a <b> & c\n\nnext')).toBe(
            'a &lt;b&gt; &amp; c<br/><br/>next',
        );
    });
});
