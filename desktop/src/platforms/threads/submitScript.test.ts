import { describe, expect, test } from 'bun:test';
import { buildClickThreadsSubmitScript } from './submitScript';

describe('buildClickThreadsSubmitScript', () => {
    test('produces valid renderer JavaScript', () => {
        const script = buildClickThreadsSubmitScript();

        expect(() => new Function(script)).not.toThrow();
    });

    test('clicks the submit button inside the ancestors of the focused editor', () => {
        let clicked = false;
        const submitButton = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'Reply' : null,
            querySelector: () => null,
            textContent: '',
            disabled: false,
            click: () => {
                clicked = true;
            },
        };
        const dialog = {
            querySelectorAll: (selector: string) =>
                selector.includes('[role="button"]') ? [submitButton] : [],
            parentElement: null,
        };
        const editor = { querySelectorAll: () => [], parentElement: dialog };
        const document = {
            activeElement: editor,
            querySelectorAll: () => [],
        };
        const run = new Function(
            'document',
            `return ${buildClickThreadsSubmitScript()};`,
        );

        expect(run(document)).toBe(true);
        expect(clicked).toBe(true);
    });

    test('falls back to a dialog-scoped button but ignores an unrelated non-dialog button elsewhere', () => {
        let dialogClicked = false;
        let strayClicked = false;
        const strayButton = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'Reply' : null,
            querySelector: () => null,
            textContent: '',
            disabled: false,
            click: () => {
                strayClicked = true;
            },
        };
        const dialogButton = {
            getClientRects: () => [{}],
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'Post' : null,
            querySelector: () => null,
            textContent: '',
            disabled: false,
            click: () => {
                dialogClicked = true;
            },
        };
        const document = {
            activeElement: null,
            querySelectorAll: (selector: string) => {
                if (selector.includes('[role="dialog"]')) return [dialogButton];
                if (selector === '[role="button"], button') return [strayButton];
                return [];
            },
        };
        const run = new Function(
            'document',
            `return ${buildClickThreadsSubmitScript()};`,
        );

        expect(run(document)).toBe(true);
        expect(dialogClicked).toBe(true);
        expect(strayClicked).toBe(false);
    });
});
