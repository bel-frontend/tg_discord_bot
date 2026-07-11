import { describe, expect, mock, test } from 'bun:test';
import { randomBytes } from 'node:crypto';

process.env.BROWSER_SESSION_ENC_KEY = randomBytes(32).toString('base64');

let stored: any = null;

const browserSessionsCollection = {
    findOne: mock(async () => stored),
    findOneAndUpdate: mock(async (_filter: any, update: any) => {
        stored = {
            ...(stored ?? { accountId: update.$setOnInsert?.accountId, platform: update.$setOnInsert?.platform }),
            ...update.$set,
            createdAt: stored?.createdAt ?? update.$setOnInsert?.createdAt,
        };
        return stored;
    }),
    updateOne: mock(async () => ({ matchedCount: 1 })),
    deleteOne: mock(async () => ({ deletedCount: 1 })),
};

// `mock.module` replaces a module for the whole test run, not just this file, so
// this mock must cover every named export any test file's import graph needs from
// `./db`. Importing the real module (side-effect-free — connections are lazy) and
// spreading it keeps the full export surface without maintaining a list by hand.
const realDb = await import('./db');
mock.module('./db', () => ({
    ...realDb,
    browserSessions: () => browserSessionsCollection,
}));

const { registerBrowserPlatform } = await import('./browserSessions/manager');
const { importBrowserSessionState, InvalidSessionStateError, validateStorageState } =
    await import('./browserSessions/importState');
const { getBrowserSessionState, getBrowserSessionStatus } = await import(
    './browserSessions/store'
);

const stubDetector = {
    isLoggedIn: async () => true,
    isLoggedOut: async () => false,
};

registerBrowserPlatform('threads', {
    loginUrl: 'https://www.threads.com/login',
    detector: stubDetector,
    sessionCookies: {
        domainSuffixes: ['threads.com', 'threads.net', 'instagram.com'],
        names: ['sessionid'],
    },
});
registerBrowserPlatform('nochecks', {
    loginUrl: 'https://example.com/login',
    detector: stubDetector,
});

const FUTURE = Date.now() / 1000 + 3600;
const PAST = Date.now() / 1000 - 3600;
const THREADS_CHECK = {
    domainSuffixes: ['threads.com', 'threads.net', 'instagram.com'],
    names: ['sessionid'],
};

function sessionCookie(overrides: Record<string, unknown> = {}) {
    return {
        name: 'sessionid',
        value: 'abc123',
        domain: '.threads.net',
        expires: FUTURE,
        ...overrides,
    };
}

describe('validateStorageState', () => {
    test('accepts a real-shaped storage state with a platform session cookie', () => {
        const state = validateStorageState(
            {
                cookies: [
                    { name: 'csrftoken', value: 'x', domain: '.instagram.com' },
                    sessionCookie(),
                ],
                origins: [{ origin: 'https://www.threads.net', localStorage: [] }],
            },
            THREADS_CHECK,
        );
        expect(state.cookies).toHaveLength(2);
    });

    test('accepts session cookies with Playwright\'s expires: -1 convention', () => {
        expect(() =>
            validateStorageState(
                { cookies: [sessionCookie({ expires: -1 })], origins: [] },
                THREADS_CHECK,
            ),
        ).not.toThrow();
    });

    test('rejects non-object payloads', () => {
        for (const raw of [null, 'cookies', 42, ['cookies']]) {
            expect(() => validateStorageState(raw)).toThrow(InvalidSessionStateError);
        }
    });

    test('rejects missing or malformed cookies', () => {
        expect(() => validateStorageState({ origins: [] })).toThrow(
            InvalidSessionStateError,
        );
        expect(() =>
            validateStorageState({ cookies: [{ name: 'sessionid' }], origins: [] }),
        ).toThrow(InvalidSessionStateError);
    });

    test('rejects missing origins', () => {
        expect(() => validateStorageState({ cookies: [] })).toThrow(
            InvalidSessionStateError,
        );
    });

    test('rejects states without the platform session cookie', () => {
        expect(() =>
            validateStorageState(
                {
                    cookies: [{ name: 'csrftoken', value: 'x', domain: '.threads.net' }],
                    origins: [],
                },
                THREADS_CHECK,
            ),
        ).toThrow(/session cookie/);
    });

    test('rejects session cookies on foreign domains, expired, or empty', () => {
        for (const cookie of [
            sessionCookie({ domain: '.evil.com' }),
            sessionCookie({ expires: PAST }),
            sessionCookie({ value: '' }),
        ]) {
            expect(() =>
                validateStorageState({ cookies: [cookie], origins: [] }, THREADS_CHECK),
            ).toThrow(InvalidSessionStateError);
        }
    });

    test('applies only the structural check when no cookie check is given', () => {
        expect(() =>
            validateStorageState({ cookies: [], origins: [] }),
        ).not.toThrow();
    });
});

describe('importBrowserSessionState', () => {
    test('rejects platforms without a registered browser config', async () => {
        expect(
            importBrowserSessionState('acct1', 'reddit', { cookies: [], origins: [] }),
        ).rejects.toThrow(InvalidSessionStateError);
    });

    test('persists a valid state and marks the session connected', async () => {
        stored = null;
        await importBrowserSessionState('acct1', 'threads', {
            cookies: [sessionCookie()],
            origins: [],
        });

        const status = await getBrowserSessionStatus('acct1', 'threads');
        expect(status?.status).toBe('connected');
        expect(status?.lastVerifiedAt).toBeInstanceOf(Date);

        const roundTripped = await getBrowserSessionState('acct1', 'threads');
        expect(JSON.parse(roundTripped!).cookies[0].name).toBe('sessionid');
    });

    test('platforms without sessionCookies fall back to structural validation', async () => {
        stored = null;
        await importBrowserSessionState('acct1', 'nochecks', {
            cookies: [],
            origins: [],
        });
        const status = await getBrowserSessionStatus('acct1', 'nochecks');
        expect(status?.status).toBe('connected');
    });
});
