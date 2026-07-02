import { describe, expect, mock, test } from 'bun:test';
import { TelegramPlatform } from './platforms/telegram';

describe('TelegramPlatform.update', () => {
    test('treats "message is not modified" as an already-updated success', async () => {
        const platform = new TelegramPlatform('test-token');
        (platform as any).bot = {
            editMessageText: mock(async () => {
                throw {
                    response: {
                        body: {
                            description: [
                                'Bad Request: message is not modified:',
                                'specified new message content and reply markup',
                                'are exactly the same as a current content and',
                                'reply markup of the message',
                            ].join(' '),
                        },
                    },
                };
            }),
        };

        const results = await platform.update(
            [{ channelId: '@channel', messageIds: ['123'] }],
            { markdown: 'same content' },
        );

        expect(results).toEqual([
            {
                platform: 'telegram',
                channelId: '@channel',
                ok: true,
                messageIds: ['123'],
            },
        ]);
    });
});
