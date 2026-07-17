import { describe, expect, mock, test } from 'bun:test';
import { BlueskyPlatform, type BlueskyAgentLike } from './index';
import type { Platform } from '../types';

const CREDS = { identifier: 'me.bsky.social', password: 'app-pass' };
const DID = 'did:plc:abc123';

function makeAgent(overrides: Partial<BlueskyAgentLike> = {}) {
    let postCount = 0;
    const posts: Array<Record<string, unknown>> = [];
    const deleted: string[] = [];
    const agent = {
        posts,
        deleted,
        login: mock(async () => ({})),
        post: mock(async (record: Record<string, unknown>) => {
            posts.push(record);
            postCount += 1;
            return {
                uri: `at://${DID}/app.bsky.feed.post/rkey${postCount}`,
                cid: `cid${postCount}`,
            };
        }),
        deletePost: mock(async (uri: string) => {
            deleted.push(uri);
        }),
        uploadBlob: mock(async () => ({ data: { blob: { ref: 'blob' } } })),
        session: { handle: 'me.bsky.social', did: DID },
        ...overrides,
    };
    return agent;
}

function makePlatform(agent: BlueskyAgentLike, creds = CREDS) {
    return new BlueskyPlatform(() => agent, creds);
}

describe('configuration gating', () => {
    test('listChannels is empty and publish fails without credentials', async () => {
        const platform = new BlueskyPlatform(() => makeAgent());
        expect(await platform.listChannels()).toEqual([]);

        const results = await platform.publish(['me'], { markdown: 'hi' });
        expect(results[0].ok).toBe(false);
        expect(results[0].error).toContain('not configured');
    });

    test('listChannels returns the account channel when configured', async () => {
        const platform = makePlatform(makeAgent());
        expect(await platform.listChannels()).toEqual([
            { id: 'me', name: 'Bluesky (me.bsky.social)' },
        ]);
    });

    test('strips a leading @ from the identifier before logging in', async () => {
        const agent = makeAgent();
        const platform = makePlatform(agent, {
            identifier: '@me.bsky.social',
            password: 'app-pass',
        });

        expect(await platform.listChannels()).toEqual([
            { id: 'me', name: 'Bluesky (me.bsky.social)' },
        ]);

        const results = await platform.publish(['me'], { markdown: 'hi' });
        expect(results[0].ok).toBe(true);
        expect(agent.login).toHaveBeenCalledWith({
            identifier: 'me.bsky.social',
            password: 'app-pass',
        });
    });
});

describe('publish', () => {
    test('publishes a short post as a single record with a bsky.app link', async () => {
        const agent = makeAgent();
        const platform = makePlatform(agent);

        const results = await platform.publish(['me'], { markdown: 'Hello!' });

        expect(results).toEqual([
            {
                platform: 'bluesky',
                channelId: 'me',
                ok: true,
                messageIds: [`at://${DID}/app.bsky.feed.post/rkey1`],
                link: 'https://bsky.app/profile/me.bsky.social/post/rkey1',
            },
        ]);
        expect(agent.posts).toHaveLength(1);
        expect(agent.posts[0].reply).toBeUndefined();
    });

    test('threads a long post as replies chained to the root', async () => {
        const agent = makeAgent();
        const platform = makePlatform(agent);
        const markdown = Array.from(
            { length: 40 },
            (_, i) => `sentence number ${i} padding words`,
        ).join(' ');

        const results = await platform.publish(['me'], { markdown });

        expect(results[0].ok).toBe(true);
        const count = agent.posts.length;
        expect(count).toBeGreaterThan(1);
        expect(results[0].messageIds).toHaveLength(count);
        for (const record of agent.posts) {
            expect((record.text as string).length).toBeLessThanOrEqual(300);
        }
        const secondReply = agent.posts[1].reply as {
            root: { uri: string };
            parent: { uri: string };
        };
        expect(secondReply.root.uri).toBe(
            `at://${DID}/app.bsky.feed.post/rkey1`,
        );
        expect(secondReply.parent.uri).toBe(
            `at://${DID}/app.bsky.feed.post/rkey1`,
        );
        const lastReply = agent.posts[count - 1].reply as {
            root: { uri: string };
            parent: { uri: string };
        };
        expect(lastReply.root.uri).toBe(`at://${DID}/app.bsky.feed.post/rkey1`);
        expect(lastReply.parent.uri).toBe(
            `at://${DID}/app.bsky.feed.post/rkey${count - 1}`,
        );
    });

    test('detects link facets in the post text', async () => {
        const agent = makeAgent();
        const platform = makePlatform(agent);

        await platform.publish(['me'], {
            markdown: 'Read [this](https://example.com/a).',
        });

        const facets = agent.posts[0].facets as Array<{
            features: Array<{ $type: string; uri?: string }>;
        }>;
        expect(facets).toHaveLength(1);
        expect(facets[0].features[0]).toMatchObject({
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.com/a',
        });
    });

    test('uploads images and embeds them on the root post only', async () => {
        const agent = makeAgent();
        const platform = makePlatform(agent);
        const markdown = Array.from({ length: 40 }, () => 'many words here').join(
            ' ',
        );

        const results = await platform.publish(['me'], {
            markdown,
            images: [
                {
                    data: new Uint8Array([1, 2, 3]),
                    filename: 'a.png',
                    contentType: 'image/png',
                },
                { data: new Uint8Array([4, 5]), filename: 'b.jpg' },
            ],
        });

        expect(results[0].ok).toBe(true);
        expect(agent.uploadBlob).toHaveBeenCalledTimes(2);
        const rootEmbed = agent.posts[0].embed as { images: unknown[] };
        expect(rootEmbed.images).toHaveLength(2);
        expect(agent.posts[1].embed).toBeUndefined();
    });

    test('rejects more than 4 images', async () => {
        const platform = makePlatform(makeAgent());
        const image = { data: new Uint8Array([1]), filename: 'x.png' };

        await expect(
            platform.publish(['me'], {
                markdown: 'hi',
                images: [image, image, image, image, image],
            }),
        ).rejects.toThrow('at most 4 images');
    });

    test('rejects an image above the 1 MB blob limit', async () => {
        const platform = makePlatform(makeAgent());

        await expect(
            platform.publish(['me'], {
                markdown: 'hi',
                images: [
                    {
                        data: new Uint8Array(1_000_001),
                        filename: 'big.png',
                    },
                ],
            }),
        ).rejects.toThrow('1 MB limit');
    });

    test('retries once with a fresh session when the token expired', async () => {
        let calls = 0;
        const agent = makeAgent({
            post: mock(async () => {
                calls += 1;
                if (calls === 1) {
                    throw Object.assign(new Error('Token has expired'), {
                        status: 401,
                    });
                }
                return {
                    uri: `at://${DID}/app.bsky.feed.post/rkey1`,
                    cid: 'cid1',
                };
            }),
        });
        const platform = makePlatform(agent);

        const results = await platform.publish(['me'], { markdown: 'hi' });

        expect(results[0].ok).toBe(true);
        expect(agent.login).toHaveBeenCalledTimes(2);
    });
});

describe('delete', () => {
    test('deletes every stored post uri', async () => {
        const agent = makeAgent();
        const platform = makePlatform(agent);
        const uris = [
            `at://${DID}/app.bsky.feed.post/rkey1`,
            `at://${DID}/app.bsky.feed.post/rkey2`,
        ];

        const results = await platform.delete([
            { channelId: 'me', messageIds: uris },
        ]);

        expect(results[0].ok).toBe(true);
        expect(agent.deleted).toEqual(uris);
    });

    test('reports a per-ref error instead of throwing', async () => {
        const agent = makeAgent({
            deletePost: mock(async () => {
                throw new Error('boom');
            }),
        });
        const platform = makePlatform(agent);

        const results = await platform.delete([
            {
                channelId: 'me',
                messageIds: [`at://${DID}/app.bsky.feed.post/rkey1`],
            },
        ]);

        expect(results[0].ok).toBe(false);
        expect(results[0].error).toBe('boom');
    });
});

describe('links and validation', () => {
    test('buildMessageLink parses an at:// post uri', () => {
        const platform = makePlatform(makeAgent());
        expect(
            platform.buildMessageLink(
                'me',
                `at://${DID}/app.bsky.feed.post/rkey9`,
            ),
        ).toBe(`https://bsky.app/profile/${DID}/post/rkey9`);
        expect(platform.buildMessageLink('me', 'not-an-at-uri')).toBeNull();
    });

    test('long posts produce no validation issues — they thread instead', () => {
        // validateContent is deliberately absent: any issue it returned would
        // block publishing in the UI, and long posts are handled by threading.
        const platform: Platform = makePlatform(makeAgent());
        expect(platform.validateContent).toBeUndefined();
    });
});
