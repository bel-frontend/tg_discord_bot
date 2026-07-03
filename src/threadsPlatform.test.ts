import { afterEach, describe, expect, test } from 'bun:test';
import { ThreadsPlatform } from './platforms/threads';

const originalFetch = globalThis.fetch;

function mockFetch(
    fn: (
        url: URL | RequestInfo,
        init?: RequestInit,
    ) => Response | Promise<Response>,
) {
    globalThis.fetch = Object.assign(fn, {
        preconnect: originalFetch.preconnect,
    }) as typeof fetch;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('ThreadsPlatform', () => {
    test('setup guide calls out Threads-specific Meta app requirements', () => {
        const platform = new ThreadsPlatform();
        const guide = [
            ...platform.setup.steps,
            ...(platform.setup.notes ?? []),
        ].join('\n');

        expect(guide).toContain('Create app');
        expect(guide).toContain('separate from the regular app id');
        expect(guide).toContain('does not support localhost');
        expect(guide).toContain('threads_content_publish');
    });

    test('publishes text through create-container and publish calls', async () => {
        const calls: Array<{ url: string; body: URLSearchParams }> = [];
        mockFetch(async (url, init) => {
            calls.push({
                url: String(url),
                body: init?.body as URLSearchParams,
            });
            return Response.json({ id: calls.length === 1 ? 'c1' : 'p1' });
        });

        const platform = new ThreadsPlatform(
            'token',
            'user-1',
            'https://threads.test/v1.0',
        );
        const results = await platform.publish(['user-1'], {
            markdown: '**Hello** [site](https://example.com)',
        });

        expect(results).toEqual([
            {
                platform: 'threads',
                channelId: 'user-1',
                ok: true,
                messageIds: ['p1'],
            },
        ]);
        expect(calls.map((call) => call.url)).toEqual([
            'https://threads.test/v1.0/user-1/threads',
            'https://threads.test/v1.0/user-1/threads_publish',
        ]);
        expect(calls[0].body.get('media_type')).toBe('TEXT');
        expect(calls[0].body.get('text')).toBe(
            'Hello site https://example.com',
        );
        expect(calls[1].body.get('creation_id')).toBe('c1');
    });

    test('splits a post over 500 characters into a threaded chain of replies', async () => {
        const containerCalls: URLSearchParams[] = [];
        let publishCount = 0;
        mockFetch(async (url, init) => {
            const body = init?.body as URLSearchParams;
            if (String(url).endsWith('/threads_publish')) {
                publishCount++;
                return Response.json({ id: `post-${publishCount}` });
            }
            containerCalls.push(body);
            return Response.json({ id: `container-${containerCalls.length}` });
        });

        const platform = new ThreadsPlatform(
            'token',
            'user-1',
            'https://threads.test/v1.0',
        );
        const longText = 'word '.repeat(200).trim(); // 999 chars, no punctuation/paragraphs
        const [result] = await platform.publish(['user-1'], {
            markdown: longText,
        });

        const messageIds = result.messageIds ?? [];
        expect(result.ok).toBe(true);
        expect(messageIds.length).toBeGreaterThan(1);
        expect(containerCalls.length).toBe(messageIds.length);

        // First post has no reply_to_id; every later chunk replies to the post right before it.
        expect(containerCalls[0].get('reply_to_id')).toBeNull();
        for (let i = 1; i < containerCalls.length; i++) {
            expect(containerCalls[i].get('reply_to_id')).toBe(
                messageIds[i - 1],
            );
        }
    });

    test('reports local uploads as unsupported because Threads needs public URLs', async () => {
        const platform = new ThreadsPlatform('token', 'user-1');
        // This validation applies identically to every target channel, so it's checked
        // once up front and rejects the whole publish() call rather than per channel;
        // registry.ts (the real caller) turns that rejection into a per-channel failure.
        await expect(
            platform.publish(['user-1'], {
                markdown: 'caption',
                images: [
                    {
                        data: new Uint8Array([1]),
                        filename: 'photo.png',
                        contentType: 'image/png',
                    },
                ],
            }),
        ).rejects.toThrow(
            'Threads requires public image URLs; uploaded files are not supported yet',
        );
    });
});
