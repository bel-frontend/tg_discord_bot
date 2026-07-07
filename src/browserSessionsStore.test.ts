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
    updateOne: mock(async (_filter: any, update: any) => {
        if (stored) stored = { ...stored, ...update.$set };
        return { matchedCount: stored ? 1 : 0 };
    }),
    deleteOne: mock(async () => {
        stored = null;
        return { deletedCount: 1 };
    }),
};

mock.module('./db', () => ({
    browserSessions: () => browserSessionsCollection,
}));

const {
    deleteBrowserSessionState,
    getBrowserSessionState,
    getBrowserSessionStatus,
    markPublished,
    markReconnectRequired,
    upsertBrowserSessionState,
} = await import('./browserSessions/store');

describe('browser session store', () => {
    test('persists and decrypts session state', async () => {
        stored = null;
        await upsertBrowserSessionState('acct1', 'x', '{"cookies":[]}');

        expect(stored.status).toBe('connected');
        expect(stored.encryptedState.ciphertext).not.toContain('cookies');

        const state = await getBrowserSessionState('acct1', 'x');
        expect(state).toBe('{"cookies":[]}');
    });

    test('getBrowserSessionState returns null once reconnect is required', async () => {
        stored = null;
        await upsertBrowserSessionState('acct1', 'x', '{"cookies":[]}');
        await markReconnectRequired('acct1', 'x');

        expect(await getBrowserSessionState('acct1', 'x')).toBeNull();
        const status = await getBrowserSessionStatus('acct1', 'x');
        expect(status?.status).toBe('reconnect_required');
    });

    test('markPublished stamps lastPublishedAt/lastVerifiedAt', async () => {
        stored = null;
        await upsertBrowserSessionState('acct1', 'x', '{"cookies":[]}');
        await markPublished('acct1', 'x');

        expect(stored.lastPublishedAt).toBeInstanceOf(Date);
        expect(stored.lastVerifiedAt).toBeInstanceOf(Date);
    });

    test('deleteBrowserSessionState removes the document', async () => {
        stored = null;
        await upsertBrowserSessionState('acct1', 'x', '{"cookies":[]}');
        await deleteBrowserSessionState('acct1', 'x');

        expect(stored).toBeNull();
        expect(await getBrowserSessionStatus('acct1', 'x')).toBeNull();
    });
});
