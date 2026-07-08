import { beforeEach, describe, expect, mock, test } from 'bun:test';
import * as browserSessionsTestDouble from './browserSessions/testSupport';
import {
    browserSessionsTestState,
    markPublished,
    markReconnectRequired,
    TestReconnectRequiredError,
} from './browserSessions/testSupport';
// Mocked via the shared test double (see its header comment) rather than a local factory,
// since only one `mock.module('./browserSessions', ...)` registration actually takes effect
// process-wide — this file controls behavior by mutating `browserSessionsTestState` instead.
mock.module('./browserSessions', () => browserSessionsTestDouble);

const { XPlatform } = await import('./platforms/x');

interface FakePageState {
    gotoUrls: string[];
    currentUrl: string;
    composeButtonCount: number;
    clickedSelectors: string[];
    filledText: string[];
    uploadedFiles: any[];
    postedHref: string | null;
    visibleStatusHrefs: string[];
    responseHandlers: Set<(response: any) => void | Promise<void>>;
    createTweetPayload?: unknown;
    onPostClick?: () => void;
    throwOnClick?: Set<string>;
    invisibleSelectors?: Set<string>;
}

function makeLocator(selector: string, state: FakePageState) {
    return {
        count: mock(async () => state.composeButtonCount),
        first: () => ({
            click: mock(async () => {
                state.clickedSelectors.push(selector);
                if (selector.includes('tweetButton')) {
                    state.onPostClick?.();
                    if (state.createTweetPayload) {
                        const response = {
                            url: () => 'https://x.com/i/api/graphql/abc/CreateTweet',
                            json: mock(async () => state.createTweetPayload),
                        };
                        await Promise.all(
                            [...state.responseHandlers].map((handler) =>
                                handler(response),
                            ),
                        );
                    }
                }
                if (
                    selector.includes('tweetButton') &&
                    state.postedHref &&
                    !state.visibleStatusHrefs.includes(state.postedHref)
                ) {
                    state.visibleStatusHrefs.push(state.postedHref);
                }
                if (state.throwOnClick?.has(selector)) {
                    throw new Error(`click failed: ${selector}`);
                }
            }),
            fill: mock(async (text: string) => {
                state.filledText.push(text);
            }),
            setInputFiles: mock(async (files: any) => {
                state.uploadedFiles.push(files);
            }),
            getAttribute: mock(async () => state.postedHref),
            waitFor: mock(async () => {
                if (
                    [...(state.invisibleSelectors ?? [])].some((hidden) =>
                        selector.includes(hidden),
                    )
                ) {
                    throw new Error(`not visible: ${selector}`);
                }
            }),
        }),
        evaluateAll: mock(async () => state.visibleStatusHrefs),
    };
}

function fakePage(state: FakePageState) {
    return {
        goto: mock(async (url: string) => {
            state.gotoUrls.push(url);
        }),
        url: () => state.currentUrl,
        locator: mock((selector: string) => makeLocator(selector, state)),
        waitForSelector: mock(async () => {
            if (
                state.postedHref &&
                !state.visibleStatusHrefs.includes(state.postedHref)
            ) {
                state.visibleStatusHrefs.push(state.postedHref);
            }
        }),
        on: mock((event: string, handler: (response: any) => void) => {
            if (event === 'response') state.responseHandlers.add(handler);
        }),
        off: mock((event: string, handler: (response: any) => void) => {
            if (event === 'response') state.responseHandlers.delete(handler);
        }),
        evaluate: mock(async (_fn: unknown, args?: any) => {
            if (args?.root) {
                state.clickedSelectors.push(args.root);
                return true;
            }
            state.clickedSelectors.push(`dom:post-more-menu:${args}`);
            return true;
        }),
    };
}

function newState(overrides: Partial<FakePageState> = {}): FakePageState {
    return {
        gotoUrls: [],
        currentUrl: 'https://x.com/home',
        composeButtonCount: 1,
        clickedSelectors: [],
        filledText: [],
        uploadedFiles: [],
        postedHref: '/someone/status/111',
        visibleStatusHrefs: [],
        responseHandlers: new Set(),
        ...overrides,
    };
}

function nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    browserSessionsTestState.sessionStatus = null;
    process.env.X_ACTION_DELAY_MS = '0';
    process.env.X_POST_CONFIRM_TIMEOUT_MS = '30000';
    process.env.BROWSER_PLATFORM_OPERATION_COOLDOWN_MS = '0';
    markPublished.mockClear();
    markReconnectRequired.mockClear();
});

describe('XPlatform', () => {
    test('publishes a short post through the compose flow and captures the posted id', async () => {
        const state = newState();
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.publish(
            ['me'],
            { markdown: 'Hello world' },
            { accountId: 'acct1' },
        );

        expect(result).toEqual({
            platform: 'x',
            channelId: 'me',
            ok: true,
            messageIds: ['111'],
            link: 'https://x.com/i/status/111',
        });
        expect(state.filledText).toEqual(['Hello world']);
        expect(state.gotoUrls).toEqual(['https://x.com/compose/post']);
        expect(markPublished).toHaveBeenCalled();
    });

    test('publishes an image-only post through the compose flow', async () => {
        const state = newState();
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.publish(
            ['me'],
            {
                markdown: '',
                images: [
                    {
                        data: new Uint8Array([1, 2, 3]),
                        filename: 'photo.png',
                        contentType: 'image/png',
                    },
                ],
            },
            { accountId: 'acct1' },
        );

        expect(result.ok).toBe(true);
        expect(result.messageIds).toEqual(['111']);
        expect(state.filledText).toEqual(['']);
        expect(state.uploadedFiles).toEqual([
            [
                {
                    name: 'photo.png',
                    mimeType: 'image/png',
                    buffer: Buffer.from([1, 2, 3]),
                },
            ],
        ]);
    });

    test('publishes text and an image in the same post', async () => {
        const state = newState();
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.publish(
            ['me'],
            {
                markdown: 'Caption text',
                images: [
                    {
                        data: new Uint8Array([1, 2, 3]),
                        filename: 'photo.png',
                        contentType: 'image/png',
                    },
                ],
            },
            { accountId: 'acct1' },
        );

        expect(result.ok).toBe(true);
        expect(result.messageIds).toEqual(['111']);
        expect(state.filledText).toEqual(['Caption text']);
        expect(state.uploadedFiles).toEqual([
            [
                {
                    name: 'photo.png',
                    mimeType: 'image/png',
                    buffer: Buffer.from([1, 2, 3]),
                },
            ],
        ]);
    });

    test('captures the new post id instead of pre-existing status links on the page', async () => {
        const state = newState({
            postedHref: '/me/status/333',
            visibleStatusHrefs: [
                '/other/status/111',
                '/sidebar/status/999',
            ],
        });
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.publish(
            ['me'],
            { markdown: 'Fresh post' },
            { accountId: 'acct1' },
        );

        expect(result).toMatchObject({
            platform: 'x',
            channelId: 'me',
            ok: true,
            messageIds: ['333'],
            link: 'https://x.com/i/status/333',
        });
    });

    test('prefers the CreateTweet response id over DOM status links', async () => {
        const state = newState({
            postedHref: '/maybe/status/333',
            visibleStatusHrefs: ['/sidebar/status/999'],
            createTweetPayload: {
                data: {
                    create_tweet: {
                        tweet_results: {
                            result: {
                                rest_id: '444',
                            },
                        },
                    },
                },
            },
        });
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.publish(
            ['me'],
            { markdown: 'Fresh post' },
            { accountId: 'acct1' },
        );

        expect(result).toMatchObject({
            ok: true,
            messageIds: ['444'],
            link: 'https://x.com/i/status/444',
        });
    });

    test('splits a post over the character limit into a self-reply thread', async () => {
        const state = newState({
            postedHref: '/someone/status/0',
            onPostClick: () => {
                postCount++;
                state.postedHref = `/someone/status/${postCount}`;
            },
        });
        let postCount = 0;
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const longText = 'word '.repeat(100).trim();
        const [result] = await platform.publish(
            ['me'],
            { markdown: longText },
            { accountId: 'acct1' },
        );

        expect(result.ok).toBe(true);
        expect(result.messageIds!.length).toBeGreaterThan(1);
        // First post goes to the compose URL; every later chunk replies on the previous post's page.
        expect(state.gotoUrls[0]).toBe('https://x.com/compose/post');
        for (let i = 1; i < state.gotoUrls.length; i++) {
            expect(state.gotoUrls[i]).toBe(
                `https://x.com/i/status/${result.messageIds![i - 1]}`,
            );
        }
    });

    test('reports a reconnect-required error when there is no connected session', async () => {
        browserSessionsTestState.nextAcquire = async () => {
            throw new TestReconnectRequiredError(
                'x session expired — reconnect in Settings',
            );
        };

        const platform = new XPlatform();
        const [result] = await platform.publish(
            ['me'],
            { markdown: 'hi' },
            { accountId: 'acct1' },
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('reconnect');
        expect(markReconnectRequired).not.toHaveBeenCalled();
    });

    test('maps a mid-publish logout to a reconnect-required failure', async () => {
        process.env.X_POST_CONFIRM_TIMEOUT_MS = '10';
        const state = newState({
            composeButtonCount: 0,
            currentUrl: 'https://x.com/home',
            postedHref: null,
        });
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.publish(
            ['me'],
            { markdown: 'hi' },
            { accountId: 'acct1' },
        );

        expect(result.ok).toBe(false);
        expect(result.error).toContain('reconnect');
        expect(markReconnectRequired).toHaveBeenCalled();
    });

    test('rejects an empty post with no text and no images', async () => {
        const platform = new XPlatform();
        await expect(
            platform.publish(['me'], { markdown: '' }, { accountId: 'acct1' }),
        ).rejects.toThrow('Write something or add an image first');
    });

    test('update deletes the old thread then republishes fresh content', async () => {
        const state = newState({ postedHref: '/someone/status/999' });
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.update!(
            [{ channelId: 'me', messageIds: ['111', '222'] }],
            { markdown: 'Updated text' },
            { accountId: 'acct1' },
        );

        expect(result).toEqual({
            platform: 'x',
            channelId: 'me',
            ok: true,
            messageIds: ['999'],
            link: 'https://x.com/i/status/999',
        });
        // Old thread is deleted newest-first, then the fresh content is posted.
        expect(state.gotoUrls).toEqual([
            'https://x.com/i/status/222',
            'https://x.com/i/status/111',
            'https://x.com/compose/post',
        ]);
        expect(
            state.clickedSelectors.some((selector) =>
                selector.includes('article:has(a[href*="/status/222"])') &&
                selector.includes('[data-testid="caret"]'),
            ),
        ).toBe(true);
        expect(state.clickedSelectors).toContain(
            '[data-testid="confirmationSheetConfirm"]',
        );
        expect(state.filledText).toEqual(['Updated text']);
        expect(markPublished).toHaveBeenCalled();
    });

    test('deletes stored message ids from newest reply to root post', async () => {
        const state = newState();
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.delete!(
            [{ channelId: 'me', messageIds: ['111', '222'] }],
            { accountId: 'acct1' },
        );

        expect(result).toEqual({
            platform: 'x',
            channelId: 'me',
            ok: true,
            messageIds: ['111', '222'],
        });
        expect(state.gotoUrls).toEqual([
            'https://x.com/i/status/222',
            'https://x.com/i/status/111',
        ]);
        expect(
            state.clickedSelectors.some((selector) =>
                selector.includes('article:has(a[href*="/status/222"])') &&
                selector.includes('[data-testid="caret"]'),
            ),
        ).toBe(true);
        expect(state.clickedSelectors).toContain(
            '[data-testid="confirmationSheetConfirm"]',
        );
        expect(markPublished).not.toHaveBeenCalled();
    });

    test('deletes through DOM fallbacks when X changes menu and confirmation selectors', async () => {
        const state = newState({
            invisibleSelectors: new Set([
                '[data-testid="caret"]',
                '[data-testid="confirmationSheetConfirm"]',
            ]),
        });
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new XPlatform();
        const [result] = await platform.delete!(
            [{ channelId: 'me', messageIds: ['111'] }],
            { accountId: 'acct1' },
        );

        expect(result.ok).toBe(true);
        expect(state.gotoUrls).toEqual(['https://x.com/i/status/111']);
        expect(state.clickedSelectors).toContain('dom:post-more-menu:111');
        expect(state.clickedSelectors).toContain(
            '[role="dialog"] [role="button"], [role="alertdialog"] [role="button"], button',
        );
        expect(markPublished).not.toHaveBeenCalled();
    });

    test('serializes browser operations for the same account', async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;

        browserSessionsTestState.nextAcquire = async () => {
            const index = events.filter((event) => event === 'acquire').length + 1;
            events.push('acquire');
            if (index === 1) {
                await new Promise<void>((resolve) => {
                    releaseFirst = resolve;
                });
            }
            return {
                page: fakePage(newState({ postedHref: `/someone/status/${index}` })),
                release: mock(async () => {
                    events.push(`release-${index}`);
                }),
            };
        };

        const platform = new XPlatform();
        const first = platform.publish(
            ['me'],
            { markdown: 'first' },
            { accountId: 'acct1' },
        );
        await nextTick();
        const second = platform.publish(
            ['me'],
            { markdown: 'second' },
            { accountId: 'acct1' },
        );

        await nextTick();
        expect(events).toEqual(['acquire']);

        releaseFirst();
        const [firstResult, secondResult] = await Promise.all([first, second]);

        expect(firstResult[0].ok).toBe(true);
        expect(secondResult[0].ok).toBe(true);
        expect(events).toEqual(['acquire', 'release-1', 'acquire', 'release-2']);
    });

    test('listChannels returns the connected account only when a session is connected', async () => {
        const platform = new XPlatform();

        browserSessionsTestState.sessionStatus = null;
        expect(await platform.listChannels({ accountId: 'acct1' })).toEqual([]);

        browserSessionsTestState.sessionStatus = { status: 'connected' };
        expect(await platform.listChannels({ accountId: 'acct1' })).toEqual([
            { id: 'me', name: 'Connected X account' },
        ]);
    });
});
