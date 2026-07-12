import { afterEach, describe, expect, test } from 'bun:test';
import { ThreadsPlatform } from './platforms/threads';

const originalFetch = globalThis.fetch;

function mockFetch(
    fn: (
        url: URL | RequestInfo,
        init?: RequestInit,
    ) => Response | Promise<Response>,
): void {
    globalThis.fetch = Object.assign(fn, {
        preconnect: originalFetch.preconnect,
    }) as typeof fetch;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('ThreadsPlatform official API adapter', () => {
    test('exposes OAuth setup instead of browser connection setup', () => {
        const platform = new ThreadsPlatform();
        expect(platform.setup.connect).toBe('oauth');
        expect(platform.setup.configFields.map((field) => field.name)).toEqual([
            'THREADS_APP_ID',
            'THREADS_APP_SECRET',
            'THREADS_ACCESS_TOKEN',
            'THREADS_USER_ID',
        ]);
    });

    test('publishes text through container and publish endpoints', async () => {
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

    test('creates a reply chain for text over 500 characters', async () => {
        const containers: URLSearchParams[] = [];
        let published = 0;
        mockFetch(async (url, init) => {
            if (String(url).endsWith('/threads_publish')) {
                published++;
                return Response.json({ id: `post-${published}` });
            }
            containers.push(init?.body as URLSearchParams);
            return Response.json({ id: `container-${containers.length}` });
        });

        const platform = new ThreadsPlatform(
            'token',
            'user-1',
            'https://threads.test/v1.0',
        );
        const [result] = await platform.publish(['user-1'], {
            markdown: 'word '.repeat(200).trim(),
        });

        expect(result.ok).toBe(true);
        expect(result.messageIds!.length).toBeGreaterThan(1);
        expect(containers[0].get('reply_to_id')).toBeNull();
        for (let i = 1; i < containers.length; i++) {
            expect(containers[i].get('reply_to_id')).toBe(
                result.messageIds![i - 1],
            );
        }
    });

    test('passes a public image URL to the first container', async () => {
        const bodies: URLSearchParams[] = [];
        mockFetch(async (_url, init) => {
            bodies.push(init?.body as URLSearchParams);
            return Response.json({ id: bodies.length === 1 ? 'c1' : 'p1' });
        });
        const platform = new ThreadsPlatform(
            'token',
            'user-1',
            'https://threads.test/v1.0',
        );

        await platform.publish(['user-1'], {
            markdown: 'Caption',
            imageUrls: ['https://cdn.example/photo.jpg'],
        });

        expect(bodies[0].get('media_type')).toBe('IMAGE');
        expect(bodies[0].get('image_url')).toBe(
            'https://cdn.example/photo.jpg',
        );
    });

    test('reports Graph API errors without hiding the platform message', async () => {
        mockFetch(async () =>
            Response.json(
                { error: { message: 'Invalid OAuth access token' } },
                { status: 401 },
            ),
        );
        const platform = new ThreadsPlatform(
            'token',
            'user-1',
            'https://threads.test/v1.0',
        );

        const [result] = await platform.publish(['user-1'], {
            markdown: 'Hello',
        });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('Invalid OAuth access token');
    });

    test('deletes a thread from its last reply to its first post', async () => {
        const calls: Array<{ url: string; method?: string }> = [];
        mockFetch(async (url, init) => {
            calls.push({ url: String(url), method: init?.method });
            return Response.json({ success: true });
        });
        const platform = new ThreadsPlatform(
            'token',
            'user-1',
            'https://threads.test/v1.0',
        );

        const [result] = await platform.delete([
            { channelId: 'user-1', messageIds: ['p1', 'p2'] },
        ]);

        expect(result.ok).toBe(true);
        expect(calls).toEqual([
            { url: 'https://threads.test/v1.0/p2', method: 'DELETE' },
            { url: 'https://threads.test/v1.0/p1', method: 'DELETE' },
        ]);
    });

    test('rejects local uploads because Meta needs a public URL', async () => {
        const platform = new ThreadsPlatform('token', 'user-1');
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
