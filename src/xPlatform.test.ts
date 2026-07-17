import { describe, expect, test } from 'bun:test';
import { XPlatform } from './platforms/x';

describe('XPlatform local publisher adapter', () => {
    test('is desktop-only and describes the local browser flow', () => {
        const platform = new XPlatform();
        expect(platform.desktopOnly).toBe(true);
        expect(platform.setup.connect).toBe('desktop-browser');
        expect(platform.setup.steps.join('\n')).toContain('Connect X');
        expect(platform.setup.notes.join('\n')).toContain('never uploaded');
    });

    test('keeps the X markdown preview and message links', () => {
        const platform = new XPlatform();
        expect(platform.toPreviewHtml('**Hello**')).toContain('Hello');
        expect(platform.buildMessageLink('me', '123')).toBe(
            'https://x.com/i/status/123',
        );
    });

    test('keeps X visible in the desktop picker between heartbeats', async () => {
        const platform = new XPlatform();

        expect(
            await platform.listChannels({ accountId: 'workspace-id' }),
        ).toEqual([{ id: 'me', name: 'Local X profile' }]);
        expect(await platform.listChannels()).toEqual([]);
    });
});
