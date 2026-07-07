import { describe, expect, mock, test } from 'bun:test';

function fakePage() {
    return {
        goto: mock(async () => {}),
        url: mock(() => 'https://example.test/home'),
        locator: mock(() => ({ count: mock(async () => 1) })),
        setViewportSize: mock(async () => {}),
        close: mock(async () => {}),
    };
}

function fakeCdp() {
    return {
        send: mock(async () => ({})),
        on: mock(() => {}),
        off: mock(() => {}),
    };
}

function makeFakeContext() {
    const page = fakePage();
    const cdp = fakeCdp();
    return {
        newPage: mock(async () => page),
        newCDPSession: mock(async () => cdp),
        storageState: mock(async () => ({ cookies: [], origins: [] })),
    };
}

function makeFakeBrowser() {
    const context = makeFakeContext();
    return {
        newContext: mock(async () => context),
        close: mock(async () => {}),
    };
}

mock.module('playwright-core', () => ({
    chromium: {
        launch: mock(async () => makeFakeBrowser()),
    },
}));

let storedState: string | null = null;
const upsertBrowserSessionState = mock(
    async (_accountId: string, _platform: string, json: string) => {
        storedState = json;
    },
);
const getBrowserSessionState = mock(async () => storedState);
const deleteBrowserSessionState = mock(async () => {
    storedState = null;
});

mock.module('./browserSessions/store', () => ({
    upsertBrowserSessionState,
    getBrowserSessionState,
    deleteBrowserSessionState,
}));

process.env.BROWSER_LOGIN_POLL_MS = '20';

const {
    acquireAutomationContext,
    disconnectPlatform,
    getSession,
    registerBrowserPlatform,
    startConnectSession,
    sweepIdleSessions,
} = await import('./browserSessions/manager');
const { ReconnectRequiredError } = await import('./browserSessions/types');

describe('browser session manager', () => {
    test('throws for a platform with no registered browser-session config', async () => {
        await expect(
            startConnectSession('acct1', 'never-registered'),
        ).rejects.toThrow(/No browser-session config registered/);
    });

    test('enforces the concurrent session cap', async () => {
        registerBrowserPlatform('unit-cap', {
            loginUrl: 'https://example.test/login',
            detector: { isLoggedIn: async () => false, isLoggedOut: async () => false },
        });
        const original = process.env.MAX_CONCURRENT_BROWSER_SESSIONS;
        process.env.MAX_CONCURRENT_BROWSER_SESSIONS = '0';
        await expect(startConnectSession('acct1', 'unit-cap')).rejects.toThrow(
            'Too many active browser sessions, try again shortly',
        );
        if (original === undefined) delete process.env.MAX_CONCURRENT_BROWSER_SESSIONS;
        else process.env.MAX_CONCURRENT_BROWSER_SESSIONS = original;
    });

    test('a session moves from awaiting_login to connected once the detector reports logged in, persisting storageState', async () => {
        registerBrowserPlatform('unit-login', {
            loginUrl: 'https://example.test/login',
            detector: { isLoggedIn: async () => true, isLoggedOut: async () => false },
        });

        const handle = await startConnectSession('acct1', 'unit-login');
        expect(handle.phase).toBe('awaiting_login');

        await new Promise((resolve) => setTimeout(resolve, 150));

        // Once connected the live session is torn down — getSession no longer finds it.
        expect(getSession(handle.sessionId)).toBeUndefined();
        expect(storedState).not.toBeNull();
    });

    test('acquireAutomationContext throws ReconnectRequiredError with no persisted session', async () => {
        registerBrowserPlatform('unit-noauth', {
            loginUrl: 'https://example.test/login',
            detector: { isLoggedIn: async () => true, isLoggedOut: async () => false },
        });
        storedState = null;

        await expect(
            acquireAutomationContext('acct2', 'unit-noauth'),
        ).rejects.toThrow(ReconnectRequiredError);
    });

    test('acquireAutomationContext reuses a persisted session for publish() calls', async () => {
        registerBrowserPlatform('unit-reuse', {
            loginUrl: 'https://example.test/login',
            detector: { isLoggedIn: async () => true, isLoggedOut: async () => false },
        });
        storedState = JSON.stringify({ cookies: [], origins: [] });

        const { page, release } = await acquireAutomationContext(
            'acct3',
            'unit-reuse',
        );
        expect(page).toBeDefined();
        await release();
        await disconnectPlatform('acct3', 'unit-reuse');
    });

    test('sweepIdleSessions is a no-op when nothing is active', async () => {
        await expect(sweepIdleSessions()).resolves.toBeUndefined();
    });
});
