import { describe, expect, test } from 'bun:test';
import {
    buildClickThreadsSubmitScript,
    buildSnapshotThreadsComposerButtonsScript,
} from './submitScript';

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

    test('matches a Russian submit button labeled with the noun form "Ответ" instead of the verb "ответить"', () => {
        let clicked = false;
        const svg = {
            getAttribute: (name: string) =>
                name === 'aria-label' ? 'Ответ' : null,
        };
        const submitButton = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            querySelector: (selector: string) =>
                selector === '[aria-label]' ? svg : null,
            textContent: '',
            disabled: false,
            click: () => {
                clicked = true;
            },
        };
        const editor = {
            querySelectorAll: (selector: string) =>
                selector.includes('[role="button"]') ? [submitButton] : [],
            parentElement: null,
        };
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

    test('falls back to whichever nearby button became enabled after typing, even with no recognizable label', () => {
        let clicked = false;
        const unlabeledButton = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            disabled: false,
            click: () => {
                clicked = true;
            },
        };
        const fakeWindow = {
            __threadsComposerButtons: [
                { el: unlabeledButton, wasDisabled: true },
            ],
        };
        const document = {
            activeElement: null,
            querySelectorAll: () => [],
        };
        const run = new Function(
            'document',
            'window',
            `return ${buildClickThreadsSubmitScript()};`,
        );

        expect(run(document, fakeWindow)).toBe(true);
        expect(clicked).toBe(true);
    });

    test('does not use the enabled-state fallback for a button that was already enabled before typing', () => {
        const alreadyEnabledButton = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            disabled: false,
            click: () => {
                throw new Error('should not be clicked');
            },
        };
        const fakeWindow = {
            __threadsComposerButtons: [
                { el: alreadyEnabledButton, wasDisabled: false },
            ],
        };
        const document = {
            activeElement: null,
            querySelectorAll: () => [],
        };
        const run = new Function(
            'document',
            'window',
            `return ${buildClickThreadsSubmitScript()};`,
        );

        expect(run(document, fakeWindow)).toBe(false);
    });
});

describe('buildSnapshotThreadsComposerButtonsScript', () => {
    test('produces valid renderer JavaScript', () => {
        const script = buildSnapshotThreadsComposerButtonsScript();

        expect(() => new Function(script)).not.toThrow();
    });

    test('records the disabled state of every button near the focused editor', () => {
        const disabledButton = {
            getAttribute: (name: string) =>
                name === 'aria-disabled' ? 'true' : null,
            disabled: false,
        };
        const enabledButton = {
            getAttribute: () => null,
            disabled: false,
        };
        const toolbar = {
            querySelectorAll: () => [disabledButton, enabledButton],
            parentElement: null,
        };
        const editor = { querySelectorAll: () => [], parentElement: toolbar };
        const fakeWindow: { __threadsComposerButtons?: unknown } = {};
        const document = { activeElement: editor };
        const run = new Function(
            'document',
            'window',
            `return ${buildSnapshotThreadsComposerButtonsScript()};`,
        );

        expect(run(document, fakeWindow)).toBe(true);
        expect(fakeWindow.__threadsComposerButtons).toEqual([
            { el: disabledButton, wasDisabled: true },
            { el: enabledButton, wasDisabled: false },
        ]);
    });
});
