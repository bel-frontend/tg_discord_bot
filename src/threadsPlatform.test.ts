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

const { ThreadsPlatform } = await import('./platforms/threads');

interface FakePageState {
    gotoUrls: string[];
    currentUrl: string;
    passwordInputCount: number;
    clickedSelectors: string[];
    filledText: string[];
    uploadedFiles: any[];
    postedHref: string | null;
    profileHref: string | null;
    throwOnClick?: Set<string>;
}

function makeLocator(selector: string, state: FakePageState) {
    const locatorActions = {
        click: mock(async () => {
            state.clickedSelectors.push(selector);
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
        getAttribute: mock(async () =>
            selector.includes('has-text("Profile")') ||
            selector.includes('has-text("Profil")') ||
            selector.includes('has-text("Профиль")') ||
            selector.includes('has-text("Профіль")')
                ? state.profileHref
                : state.postedHref,
        ),
        waitFor: mock(async () => {}),
    };
    return {
        count: mock(async () => state.passwordInputCount),
        first: () => locatorActions,
        nth: () => locatorActions,
    };
}

function fakePage(state: FakePageState) {
    return {
        goto: mock(async (url: string) => {
            state.gotoUrls.push(url);
        }),
        url: () => state.currentUrl,
        locator: mock((selector: string) => makeLocator(selector, state)),
        waitForSelector: mock(async () => {}),
        evaluate: mock(async (_fn: unknown, args?: any) => {
            if (args?.root) {
                state.clickedSelectors.push(args.root);
                return true;
            }
            if (typeof args === 'string') {
                const profilePath = args;
                return state.postedHref?.startsWith(`${profilePath}/post/`)
                    ? [state.postedHref]
                    : [];
            }
            return state.gotoUrls.at(-1)?.includes('/t/') ? 0 : state.profileHref;
        }),
    };
}

function newState(overrides: Partial<FakePageState> = {}): FakePageState {
    return {
        gotoUrls: [],
        currentUrl: 'https://www.threads.net/',
        passwordInputCount: 0,
        clickedSelectors: [],
        filledText: [],
        uploadedFiles: [],
        postedHref: '/@someone/post/111',
        profileHref: '/@someone',
        ...overrides,
    };
}

function nextTick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
    browserSessionsTestState.sessionStatus = null;
    process.env.THREADS_ACTION_DELAY_MS = '0';
    process.env.BROWSER_PLATFORM_OPERATION_COOLDOWN_MS = '0';
    markPublished.mockClear();
    markReconnectRequired.mockClear();
});

describe('ThreadsPlatform', () => {
    test('publishes a short post through the compose flow and captures the posted id', async () => {
        const state = newState();
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new ThreadsPlatform();
        const [result] = await platform.publish(
            ['me'],
            { markdown: 'Hello world' },
            { accountId: 'acct1' },
        );

        expect(result).toEqual({
            platform: 'threads',
            channelId: 'me',
            ok: true,
            messageIds: ['111'],
            link: 'https://www.threads.com/t/111',
        });
        expect(state.filledText).toEqual([]);
        expect(state.gotoUrls).toEqual([
            'https://www.threads.com/intent/post?text=Hello%20world',
        ]);
        expect(markPublished).toHaveBeenCalled();
    });

    test('uploads raw image bytes via the file input instead of rejecting them', async () => {
        const state = newState();
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new ThreadsPlatform();
        const [result] = await platform.publish(
            ['me'],
            {
                markdown: 'With a photo',
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

    test('splits a post over the character limit into a threaded chain of replies', async () => {
        const state = newState({ postedHref: '/@someone/post/1' });
        let postCount = 0;
        browserSessionsTestState.nextAcquire = async () => ({
            page: {
                ...fakePage(state),
                waitForSelector: mock(async () => {
                    postCount++;
                    state.postedHref = `/@someone/post/${postCount}`;
                }),
            },
            release: mock(async () => {}),
        });

        const platform = new ThreadsPlatform();
        const longText = 'word '.repeat(150).trim();
        const [result] = await platform.publish(
            ['me'],
            { markdown: longText },
            { accountId: 'acct1' },
        );

        expect(result.ok).toBe(true);
        expect(result.messageIds!.length).toBeGreaterThan(1);
        // Each publish step confirms the id from the user's profile before the next reply.
        expect(
            state.gotoUrls[0].startsWith(
                'https://www.threads.com/intent/post?text=',
            ),
        ).toBe(true);
        expect(state.gotoUrls).toContain(
            `https://www.threads.com/t/${result.messageIds![0]}`,
        );
    });

    test('reports a reconnect-required error when there is no connected session', async () => {
        browserSessionsTestState.nextAcquire = async () => {
            throw new TestReconnectRequiredError(
                'threads session expired — reconnect in Settings',
            );
        };

        const platform = new ThreadsPlatform();
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
        // Simulates getting bounced back to the login page mid-publish (session expired).
        const state = newState({
            currentUrl: 'https://www.threads.net/login',
        });
        browserSessionsTestState.nextAcquire = async () => ({
            page: {
                ...fakePage(state),
                waitForSelector: mock(async () => {
                    throw new Error('timed out waiting for post confirmation');
                }),
            },
            release: mock(async () => {}),
        });

        const platform = new ThreadsPlatform();
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
        const platform = new ThreadsPlatform();
        await expect(
            platform.publish(['me'], { markdown: '' }, { accountId: 'acct1' }),
        ).rejects.toThrow('Write something or add an image first');
    });

    test('deletes stored message ids from newest reply to root post', async () => {
        const state = newState();
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new ThreadsPlatform();
        const [result] = await platform.delete!(
            [{ channelId: 'me', messageIds: ['111', '222'] }],
            { accountId: 'acct1' },
        );

        expect(result).toEqual({
            platform: 'threads',
            channelId: 'me',
            ok: true,
            messageIds: ['111', '222'],
        });
        expect(state.gotoUrls).toEqual([
            'https://www.threads.com/t/222',
            'https://www.threads.com/t/111',
        ]);
        expect(state.clickedSelectors).toContain(
            'div[role="button"][aria-haspopup="menu"]',
        );
        expect(state.clickedSelectors).toContain(
            '[role="dialog"] div[role="button"]',
        );
        expect(markPublished).not.toHaveBeenCalled();
    });

    test('update deletes the old thread then republishes fresh content', async () => {
        const state = newState({ postedHref: '/@someone/post/999' });
        browserSessionsTestState.nextAcquire = async () => ({
            page: fakePage(state),
            release: mock(async () => {}),
        });

        const platform = new ThreadsPlatform();
        const [result] = await platform.update!(
            [{ channelId: 'me', messageIds: ['111', '222'] }],
            { markdown: 'Updated text' },
            { accountId: 'acct1' },
        );

        expect(result).toEqual({
            platform: 'threads',
            channelId: 'me',
            ok: true,
            messageIds: ['999'],
            link: 'https://www.threads.com/t/999',
        });
        // Old thread is deleted newest-first, then the fresh content is posted.
        expect(state.gotoUrls).toEqual([
            'https://www.threads.com/t/222',
            'https://www.threads.com/t/111',
            'https://www.threads.com/intent/post?text=Updated%20text',
        ]);
        expect(state.clickedSelectors).toContain(
            'div[role="button"][aria-haspopup="menu"]',
        );
        expect(state.clickedSelectors).toContain(
            '[role="dialog"] div[role="button"]',
        );
        expect(state.filledText).toEqual([]);
        expect(markPublished).toHaveBeenCalled();
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
                page: fakePage(newState({ postedHref: `/@someone/post/${index}` })),
                release: mock(async () => {
                    events.push(`release-${index}`);
                }),
            };
        };

        const platform = new ThreadsPlatform();
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
        const platform = new ThreadsPlatform();

        browserSessionsTestState.sessionStatus = null;
        expect(await platform.listChannels({ accountId: 'acct1' })).toEqual([]);

        browserSessionsTestState.sessionStatus = { status: 'connected' };
        expect(await platform.listChannels({ accountId: 'acct1' })).toEqual([
            { id: 'me', name: 'Connected Threads account' },
        ]);
    });
});
