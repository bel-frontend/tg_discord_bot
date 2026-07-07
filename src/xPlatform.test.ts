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
    filledText: string[];
    uploadedFiles: any[];
    postedHref: string | null;
    throwOnClick?: Set<string>;
}

function makeLocator(selector: string, state: FakePageState) {
    return {
        count: mock(async () => state.composeButtonCount),
        first: () => ({
            click: mock(async () => {
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
            waitFor: mock(async () => {}),
        }),
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
    };
}

function newState(overrides: Partial<FakePageState> = {}): FakePageState {
    return {
        gotoUrls: [],
        currentUrl: 'https://x.com/home',
        composeButtonCount: 1,
        filledText: [],
        uploadedFiles: [],
        postedHref: '/someone/status/111',
        ...overrides,
    };
}

beforeEach(() => {
    browserSessionsTestState.sessionStatus = null;
    process.env.X_ACTION_DELAY_MS = '0';
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

    test('splits a post over the character limit into a self-reply thread', async () => {
        const state = newState({ postedHref: '/someone/status/1' });
        let postCount = 0;
        browserSessionsTestState.nextAcquire = async () => ({
            page: {
                ...fakePage(state),
                waitForSelector: mock(async () => {
                    postCount++;
                    state.postedHref = `/someone/status/${postCount}`;
                }),
            },
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
        const state = newState({
            composeButtonCount: 0,
            currentUrl: 'https://x.com/home',
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
