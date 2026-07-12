import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { localPublisherAgents } from './db';

const PAIRING_TTL_MS = 10 * 60_000;
const ONLINE_WINDOW_MS = 45_000;

interface PendingPairing {
    accountId: string;
    expiresAt: number;
}

const pendingPairings = new Map<string, PendingPairing>();

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function normalizeCode(code: string): string {
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

export function createPairingCode(accountId: string): {
    code: string;
    expiresAt: string;
} {
    const raw = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const code = `${raw.slice(0, 3)}-${raw.slice(3)}`;
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    pendingPairings.set(hash(normalizeCode(code)), { accountId, expiresAt });
    return { code, expiresAt: new Date(expiresAt).toISOString() };
}

export async function pairLocalPublisher(input: {
    code?: unknown;
    name?: unknown;
}): Promise<{ token: string; agentId: string }> {
    const codeHash = hash(normalizeCode(String(input.code ?? '')));
    const pending = pendingPairings.get(codeHash);
    pendingPairings.delete(codeHash);
    if (!pending || pending.expiresAt < Date.now()) {
        throw new Error('Pairing code is invalid or expired');
    }

    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const result = await localPublisherAgents().insertOne({
        accountId: pending.accountId,
        name: String(input.name ?? '').trim().slice(0, 80) || 'Desktop client',
        tokenHash: hash(token),
        status: 'active',
        platforms: [],
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
    });
    return { token, agentId: result.insertedId.toString() };
}

export async function authenticateLocalPublisher(token: string) {
    if (!token) return null;
    return localPublisherAgents().findOne({
        tokenHash: hash(token),
        status: 'active',
    });
}

export async function heartbeatLocalPublisher(
    token: string,
    platforms: unknown,
): Promise<{ ok: true }> {
    const agent = await authenticateLocalPublisher(token);
    if (!agent) throw new Error('Invalid local publisher token');
    const nextPlatforms = Array.isArray(platforms)
        ? platforms.map(String).filter((id) => ['threads', 'x'].includes(id))
        : [];
    await localPublisherAgents().updateOne(
        { _id: agent._id, status: 'active' },
        {
            $set: {
                platforms: [...new Set(nextPlatforms)],
                lastSeenAt: new Date(),
                updatedAt: new Date(),
            },
        },
    );
    return { ok: true };
}

export async function listLocalPublishers(accountId: string) {
    const docs = await localPublisherAgents()
        .find({ accountId, status: 'active' })
        .sort({ createdAt: -1 })
        .toArray();
    return docs.map((doc) => ({
        id: doc._id!.toString(),
        name: doc.name,
        platforms: doc.platforms,
        online: Boolean(
            doc.lastSeenAt &&
                Date.now() - doc.lastSeenAt.getTime() <= ONLINE_WINDOW_MS,
        ),
        lastSeenAt: doc.lastSeenAt?.toISOString(),
        createdAt: doc.createdAt.toISOString(),
    }));
}

export async function hasOnlineLocalPublisher(
    accountId: string,
    platform: 'threads' | 'x',
): Promise<boolean> {
    const threshold = new Date(Date.now() - ONLINE_WINDOW_MS);
    return Boolean(
        await localPublisherAgents().findOne({
            accountId,
            status: 'active',
            platforms: platform,
            lastSeenAt: { $gte: threshold },
        }),
    );
}

export async function revokeLocalPublisher(
    accountId: string,
    id: string,
): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await localPublisherAgents().updateOne(
        { _id: new ObjectId(id), accountId },
        { $set: { status: 'revoked', updatedAt: new Date() } },
    );
    return result.matchedCount > 0;
}
