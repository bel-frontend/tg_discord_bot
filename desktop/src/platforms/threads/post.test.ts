import { describe, expect, test } from 'bun:test';
import { normalizeThreadsPostUrl } from './post';

describe('normalizeThreadsPostUrl', () => {
    test('accepts Threads post links used for reply jobs', () => {
        expect(
            normalizeThreadsPostUrl(
                'https://www.threads.com/@composer/post/ABC123?xmt=1',
            ),
        ).toBe('https://www.threads.com/@composer/post/ABC123?xmt=1');
        expect(
            normalizeThreadsPostUrl(
                'https://www.threads.net/@composer/post/XYZ789',
            ),
        ).toBe('https://www.threads.net/@composer/post/XYZ789');
    });

    test('rejects external and non-post links', () => {
        expect(() =>
            normalizeThreadsPostUrl(
                'https://example.com/@composer/post/ABC123',
            ),
        ).toThrow('Invalid Threads reply link');
        expect(() =>
            normalizeThreadsPostUrl('https://www.threads.com/settings'),
        ).toThrow('Invalid Threads reply link');
    });
});
