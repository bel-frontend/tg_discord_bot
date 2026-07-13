import { describe, expect, test } from 'bun:test';
import { ThreadsPlatform } from './platforms/threads';

describe('ThreadsPlatform local publisher adapter', () => {
    test('describes the desktop browser connection flow', () => {
        const platform = new ThreadsPlatform();
        expect(platform.desktopOnly).toBe(true);
        expect(platform.setup.connect).toBe('desktop-browser');
        expect(platform.setup.summary).toContain('inside Composer Desktop');
        expect(platform.setup.steps.join('\n')).toContain('Connect Threads');
        expect(platform.setup.notes.join('\n')).toContain('never uploaded');
    });

    test('keeps the Threads markdown preview', () => {
        const platform = new ThreadsPlatform();
        expect(platform.toPreviewHtml('**Hello**')).toContain('Hello');
    });
});
