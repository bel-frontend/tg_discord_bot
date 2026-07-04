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

    test('sends extra messages when the edited post grows past one message', async () => {
        const platform = new TelegramPlatform('test-token');
        const editMessageText = mock(async () => ({}));
        let nextId = 200;
        const sendMessage = mock(async () => ({ message_id: nextId++ }));
        (platform as any).bot = { editMessageText, sendMessage };

        const paragraphs = ['a', 'b', 'c']
            .map((c) => c.repeat(2100))
            .join('\n\n');
        const results = await platform.update(
            [{ channelId: '@channel', messageIds: ['1'] }],
            { markdown: paragraphs },
        );

        expect(editMessageText).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(results).toEqual([
            {
                platform: 'telegram',
                channelId: '@channel',
                ok: true,
                messageIds: ['1', '200', '201'],
            },
        ]);
    });

    test('deletes extra messages when the edited post shrinks to fewer messages', async () => {
        const platform = new TelegramPlatform('test-token');
        const editMessageText = mock(async () => ({}));
        const deleteMessage = mock(async () => true);
        (platform as any).bot = { editMessageText, deleteMessage };

        const results = await platform.update(
            [{ channelId: '@channel', messageIds: ['1', '2', '3'] }],
            { markdown: 'short update' },
        );

        expect(editMessageText).toHaveBeenCalledTimes(1);
        expect(deleteMessage).toHaveBeenCalledTimes(2);
        expect(deleteMessage).toHaveBeenNthCalledWith(1, '@channel', 2);
        expect(deleteMessage).toHaveBeenNthCalledWith(2, '@channel', 3);
        expect(results).toEqual([
            {
                platform: 'telegram',
                channelId: '@channel',
                ok: true,
                messageIds: ['1'],
            },
        ]);
    });

    test('falls back to caption editing for a photo message past index 0', async () => {
        const platform = new TelegramPlatform('test-token');
        const editMessageText = mock(async (_text: string, opts: any) => {
            if (opts.message_id === 2) {
                throw {
                    response: {
                        body: { description: 'Bad Request: no text in the message to edit' },
                    },
                };
            }
            return {};
        });
        const editMessageCaption = mock(async () => ({}));
        (platform as any).bot = { editMessageText, editMessageCaption };

        const results = await platform.update(
            [{ channelId: '@channel', messageIds: ['1', '2'] }],
            { markdown: 'a'.repeat(4200) },
        );

        expect(editMessageCaption).toHaveBeenCalledTimes(1);
        expect(results[0].ok).toBe(true);
        expect(results[0].messageIds).toEqual(['1', '2']);
    });
});
