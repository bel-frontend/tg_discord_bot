import { describe, expect, test } from 'bun:test';
import {
    buildClickThreadsDeleteMenuItemScript,
    buildClickThreadsMoreScript,
    buildConfirmThreadsDeleteScript,
} from './deleteScript';

describe('Threads delete renderer scripts', () => {
    test('produce valid renderer JavaScript', () => {
        const scripts = [
            buildClickThreadsMoreScript(
                'https://www.threads.com/@composer/post/ABC123',
            ),
            buildClickThreadsDeleteMenuItemScript(),
            buildConfirmThreadsDeleteScript(),
        ];

        for (const script of scripts) {
            expect(() => new Function(script)).not.toThrow();
        }
    });

    test('clicks the More button on the target post instead of focusing an unrelated visible reply box', () => {
        let editorFocused = false;
        let moreClicked = false;
        const replyEditor = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            focus: () => {
                editorFocused = true;
            },
        };
        const moreButton = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'More' : null,
            querySelector: () => null,
            textContent: '',
            click: () => {
                moreClicked = true;
            },
        };
        const ancestor = {
            querySelectorAll: (selector: string) =>
                selector.includes('[role="button"]') ? [moreButton] : [],
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
                if (selector.includes('contenteditable')) return [replyEditor];
                return [];
            },
        };
        const script = buildClickThreadsMoreScript(
            'https://www.threads.com/@composer/post/ABC123',
        );
        const run = new Function('document', 'URL', `return ${script};`);

        expect(run(document, URL)).toBe(true);
        expect(moreClicked).toBe(true);
        expect(editorFocused).toBe(false);
    });
});
