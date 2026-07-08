import { describe, expect, test } from 'bun:test';
import { markdownToThreadsText } from './platforms/threads/markdown';

describe('markdownToThreadsText', () => {
    test('flattens supported markdown formatting to plain text', () => {
        expect(
            markdownToThreadsText(
                '**Bold** _italic_ ~~gone~~ `code` [site](https://example.com)',
            ),
        ).toBe('Bold italic gone code site https://example.com');
    });

    test('strips residual formatting markers when markdown is not parser-valid', () => {
        expect(markdownToThreadsText('**Добры вечар! **')).toBe('Добры вечар!');
    });
});
