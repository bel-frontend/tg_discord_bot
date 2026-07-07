import { browserSessions, type BrowserSessionDoc } from '../db';
import { decryptSessionBlob, encryptSessionBlob } from './crypto';

export async function getBrowserSessionState(
    accountId: string,
    platform: string,
): Promise<string | null> {
    const doc = await browserSessions().findOne({ accountId, platform });
    if (!doc || doc.status !== 'connected') return null;
    return decryptSessionBlob(doc.encryptedState);
}

export async function getBrowserSessionStatus(
    accountId: string,
    platform: string,
): Promise<Pick<BrowserSessionDoc, 'status' | 'lastVerifiedAt'> | null> {
    const doc = await browserSessions().findOne({ accountId, platform });
    if (!doc) return null;
    return { status: doc.status, lastVerifiedAt: doc.lastVerifiedAt };
}

export async function upsertBrowserSessionState(
    accountId: string,
    platform: string,
    storageStateJson: string,
): Promise<void> {
    const now = new Date();
    await browserSessions().findOneAndUpdate(
        { accountId, platform },
        {
            $set: {
                encryptedState: encryptSessionBlob(storageStateJson),
                status: 'connected',
                lastVerifiedAt: now,
                updatedAt: now,
            },
            $setOnInsert: {
                accountId,
                platform,
                createdAt: now,
            },
        },
        { upsert: true },
    );
}

export async function markReconnectRequired(
    accountId: string,
    platform: string,
): Promise<void> {
    await browserSessions().updateOne(
        { accountId, platform },
        { $set: { status: 'reconnect_required', updatedAt: new Date() } },
    );
}

export async function markPublished(
    accountId: string,
    platform: string,
): Promise<void> {
    const now = new Date();
    await browserSessions().updateOne(
        { accountId, platform },
        { $set: { lastPublishedAt: now, lastVerifiedAt: now } },
    );
}

export async function deleteBrowserSessionState(
    accountId: string,
    platform: string,
): Promise<void> {
    await browserSessions().deleteOne({ accountId, platform });
}
