import { describe, expect, test } from 'bun:test';
import {
    markdownToDiscord,
    markdownToDiscordPreviewHtml,
} from './platforms/discord/markdown';

describe('markdownToDiscord', () => {
    test('collapses heading levels beyond ### (h4-h6) down to ###', () => {
        expect(markdownToDiscord('#### Level four')).toBe('### Level four');
        expect(markdownToDiscord('##### Level five')).toBe('### Level five');
        expect(markdownToDiscord('###### Level six')).toBe('### Level six');
    });

    test('leaves ### and shallower headings untouched', () => {
        expect(markdownToDiscord('# One')).toBe('# One');
        expect(markdownToDiscord('## Two')).toBe('## Two');
        expect(markdownToDiscord('### Three')).toBe('### Three');
    });

    test('does not touch a run of hashes with no following space (not a heading)', () => {
        expect(markdownToDiscord('####hashtag')).toBe('####hashtag');
    });
});

describe('markdownToDiscordPreviewHtml', () => {
    test('renders a former h4 as an <h3> instead of leaking raw hashes', () => {
        const html = markdownToDiscordPreviewHtml('#### Three pillars');
        expect(html).toBe('<h3>Three pillars</h3>');
    });
});
