import { describe, expect, test } from 'bun:test';
import { DiscordPlatform } from './platforms/discord';

describe('DiscordPlatform.buildMessageLink', () => {
    test('returns null when no guild id is configured', () => {
        const platform = new DiscordPlatform('test-token', '');
        expect(platform.buildMessageLink('chan1', 'msg1')).toBeNull();
    });

    test('builds a link from the configured guild id', () => {
        const platform = new DiscordPlatform('test-token', 'guild1');
        expect(platform.buildMessageLink('chan1', 'msg1')).toBe(
            'https://discord.com/channels/guild1/chan1/msg1',
        );
    });
});
