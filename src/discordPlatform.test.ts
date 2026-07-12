import { describe, expect, mock, test } from 'bun:test';
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

/** Fake text channel backing an in-memory map of message id -> mocked message. */
function makeFakeChannel(existingIds: string[]) {
    type FakeMessage = {
        id: string;
        edit: ReturnType<typeof mock>;
        delete: ReturnType<typeof mock>;
    };
    const messages = new Map<string, FakeMessage>();
    for (const id of existingIds) {
        messages.set(id, {
            id,
            edit: mock(async () => {}),
            delete: mock(async () => {
                messages.delete(id);
            }),
        });
    }
    let nextId = 1;
    const channel = {
        isTextBased: () => true,
        isDMBased: () => false,
        messages: {
            fetch: mock(async (id: string) => messages.get(id)),
        },
        send: mock(async (_payload: { content: string }) => {
            const id = `new-${nextId++}`;
            const message: FakeMessage = {
                id,
                edit: mock(async () => {}),
                delete: mock(async () => {
                    messages.delete(id);
                }),
            };
            messages.set(id, message);
            return message;
        }),
    };
    return { channel, messages };
}

function paragraphsOf(length: number): string {
    return ['a', 'b', 'c'].map((c) => c.repeat(length)).join('\n\n');
}

function withFakeClient(platform: DiscordPlatform, channel: unknown) {
    (platform as any).client = {
        channels: { fetch: mock(async () => channel) },
        destroy: mock(() => {}),
    };
    (platform as any).ready = Promise.resolve();
}

describe('DiscordPlatform.update', () => {
    test('adds extra messages when the edited post grows past one message', async () => {
        const platform = new DiscordPlatform('test-token', '');
        const { channel, messages } = makeFakeChannel(['m1']);
        withFakeClient(platform, channel);

        const results = await platform.update(
            [{ channelId: 'chan1', messageIds: ['m1'] }],
            { markdown: paragraphsOf(1900) },
        );

        expect(results).toEqual([
            {
                platform: 'discord',
                channelId: 'chan1',
                ok: true,
                messageIds: ['m1', 'new-1', 'new-2'],
                link: undefined,
            },
        ]);
        expect(messages.get('m1')?.edit).toHaveBeenCalledTimes(1);
        expect(messages.size).toBe(3);
    });

    test('deletes extra messages when the edited post shrinks to fewer messages', async () => {
        const platform = new DiscordPlatform('test-token', '');
        const { channel, messages } = makeFakeChannel(['m1', 'm2', 'm3']);
        withFakeClient(platform, channel);

        const results = await platform.update(
            [{ channelId: 'chan1', messageIds: ['m1', 'm2', 'm3'] }],
            { markdown: 'short update' },
        );

        expect(results).toEqual([
            {
                platform: 'discord',
                channelId: 'chan1',
                ok: true,
                messageIds: ['m1'],
                link: undefined,
            },
        ]);
        expect(messages.get('m1')?.edit).toHaveBeenCalledTimes(1);
        expect(messages.has('m2')).toBe(false);
        expect(messages.has('m3')).toBe(false);
        expect(messages.size).toBe(1);
    });
});
