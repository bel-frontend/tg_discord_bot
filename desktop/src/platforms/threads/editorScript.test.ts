import { describe, expect, test } from 'bun:test';
import { buildFindThreadsEditorScript } from './editorScript';

describe('buildFindThreadsEditorScript', () => {
    test('produces valid renderer JavaScript', () => {
        const script = buildFindThreadsEditorScript();

        expect(() => new Function(script)).not.toThrow();
    });

    test('focuses the editor inside the dialog, not an obscured editor left over from the page behind it', () => {
        const backgroundEditor = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            focus: () => {
                throw new Error('should not focus the background editor');
            },
        };
        let dialogEditorFocused = false;
        const dialogEditor = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            focus: () => {
                dialogEditorFocused = true;
            },
        };
        const dialog = {
            querySelectorAll: () => [dialogEditor],
        };
        const document = {
            querySelector: (selector: string) =>
                selector.includes('[role="dialog"]') ? dialog : null,
            querySelectorAll: () => [backgroundEditor, dialogEditor],
        };
        const run = new Function(
            'document',
            `return ${buildFindThreadsEditorScript()};`,
        );

        expect(run(document)).toBe(true);
        expect(dialogEditorFocused).toBe(true);
    });

    test('keeps waiting for the dialog editor instead of falling back to the background one while the dialog is still rendering', () => {
        const backgroundEditor = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            focus: () => {
                throw new Error('should not focus the background editor');
            },
        };
        const dialog = {
            // The dialog exists but hasn't rendered its own editor yet.
            querySelectorAll: () => [],
        };
        const document = {
            querySelector: (selector: string) =>
                selector.includes('[role="dialog"]') ? dialog : null,
            querySelectorAll: () => [backgroundEditor],
        };
        const run = new Function(
            'document',
            `return ${buildFindThreadsEditorScript()};`,
        );

        expect(run(document)).toBe(false);
    });

    test('falls back to the plain unscoped editor when no dialog is open', () => {
        let focused = false;
        const inlineEditor = {
            getClientRects: () => [{}],
            getAttribute: () => null,
            focus: () => {
                focused = true;
            },
        };
        const document = {
            querySelector: () => null,
            querySelectorAll: () => [inlineEditor],
        };
        const run = new Function(
            'document',
            `return ${buildFindThreadsEditorScript()};`,
        );

        expect(run(document)).toBe(true);
        expect(focused).toBe(true);
    });
});
