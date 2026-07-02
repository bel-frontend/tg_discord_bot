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

    test('rejects posts over the Threads character limit before calling API', async () => {
        let called = false;
        mockFetch(async () => {
            called = true;
            return Response.json({ id: 'unused' });
        });

        const platform = new ThreadsPlatform('token', 'user-1');
        const [result] = await platform.publish(['user-1'], {
            markdown: 'x'.repeat(501),
        });

        expect(called).toBe(false);
        expect(result.ok).toBe(false);
        expect(result.error).toBe(
            'Threads posts must be 500 characters or less',
        );
    });

    test('reports local uploads as unsupported because Threads needs public URLs', async () => {
        const platform = new ThreadsPlatform('token', 'user-1');
        const [result] = await platform.publish(['user-1'], {
            markdown: 'caption',
            images: [
                {
                    data: new Uint8Array([1]),
                    filename: 'photo.png',
                    contentType: 'image/png',
                },
            ],
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe(
            'Threads requires public image URLs; uploaded files are not supported yet',
        );
    });
});
