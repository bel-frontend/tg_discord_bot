import { describe, expect, test } from 'bun:test';
import { buildClickThreadsReplyScript } from './replyScript';

describe('buildClickThreadsReplyScript', () => {
    test('produces valid renderer JavaScript for a Threads post URL', () => {
        const script = buildClickThreadsReplyScript(
            'https://www.threads.com/@composer/post/ABC123/',
        );

        expect(() => new Function(script)).not.toThrow();
        expect(script).toContain('ABC123');
    });

    test('activates an already-visible localized inline reply prompt', () => {
        let clicked = false;
        const prompt = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'placeholder'
                    ? 'Ответьте goman.live.service…'
                    : null,
            textContent: '',
            closest: () => null,
            click: () => {
                clicked = true;
            },
        };
        const document = {
            querySelectorAll: (selector: string) =>
                selector.includes('[placeholder]') ? [prompt] : [],
        };
        const script = buildClickThreadsReplyScript(
            'https://www.threads.com/@composer/post/ABC123',
        );
        const run = new Function('document', 'URL', `return ${script};`);

        expect(run(document, URL)).toBe(true);
        expect(clicked).toBe(true);
    });

    test('clicks the action button scoped to the target post permalink, not an unrelated button elsewhere', () => {
        let correctClicked = false;
        let wrongClicked = false;
        const correctButton = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'Reply' : null,
            querySelector: () => null,
            textContent: '',
            click: () => {
                correctClicked = true;
            },
        };
        const wrongButton = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'Reply' : null,
            querySelector: () => null,
            textContent: '',
            click: () => {
                wrongClicked = true;
            },
        };
        const ancestor = {
            querySelectorAll: (selector: string) =>
                selector.includes('[role="button"]') ? [correctButton] : [],
            parentElement: null,
        };
        const permalink = {
            href: 'https://www.threads.com/@composer/post/ABC123',
            querySelectorAll: () => [],
            parentElement: ancestor,
        };
        const document = {
            querySelectorAll: (selector: string) => {
                if (selector.includes('a[href*="/post/"]')) return [permalink];
                if (selector === '[role="button"], button') return [wrongButton];
                return [];
            },
        };
        const script = buildClickThreadsReplyScript(
            'https://www.threads.com/@composer/post/ABC123',
        );
        const run = new Function('document', 'URL', `return ${script};`);

        expect(run(document, URL)).toBe(true);
        expect(correctClicked).toBe(true);
        expect(wrongClicked).toBe(false);
    });

    test('does not fall back to an unrelated document-wide button when the permalink ancestor walk finds nothing', () => {
        let wrongClicked = false;
        const wrongButton = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'Reply' : null,
            querySelector: () => null,
            textContent: '',
            click: () => {
                wrongClicked = true;
            },
        };
        const permalink = {
            href: 'https://www.threads.com/@composer/post/ABC123',
            querySelectorAll: () => [],
            parentElement: null,
        };
        const document = {
            querySelectorAll: (selector: string) => {
                if (selector.includes('a[href*="/post/"]')) return [permalink];
                if (selector === '[role="button"], button') return [wrongButton];
                return [];
            },
        };
        const script = buildClickThreadsReplyScript(
            'https://www.threads.com/@composer/post/ABC123',
        );
        const run = new Function('document', 'URL', `return ${script};`);

        expect(run(document, URL)).toBe(false);
        expect(wrongClicked).toBe(false);
    });
});
