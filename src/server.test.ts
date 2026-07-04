import { describe, expect, mock, test } from 'bun:test';

const collection = () => ({
    findOne: mock(async () => null),
    find: mock(() => ({ toArray: async () => [] })),
    insertOne: mock(async () => ({ insertedId: 'id' })),
    findOneAndUpdate: mock(async () => null),
    updateOne: mock(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    deleteOne: mock(async () => ({ deletedCount: 0 })),
    deleteMany: mock(async () => ({ deletedCount: 0 })),
});

mock.module('./db', () => ({
    FULL_ACCESS_PERMISSIONS: {
        canPublish: true,
        canManageResources: true,
        canManagePlatforms: true,
        canManageMembers: true,
        channelAccess: 'all',
    },
    users: collection,
    accountMembers: collection,
    emailVerifications: collection,
    passwordResets: collection,
    emailChanges: collection,
    channelResources: collection,
    drafts: collection,
    uploads: collection,
    platformConfigs: collection,
    publications: collection,
    scheduledPublications: collection,
}));

const { handleApi } = await import('./server');

async function head(path: string): Promise<Response> {
    const url = new URL(`https://composer.bel-geek.com${path}`);
    return handleApi(new Request(url, { method: 'HEAD' }), url);
}

describe('server public callback probes', () => {
    test('allows HEAD probes for Threads callback URLs without auth', async () => {
        const paths = [
            '/api/threads/oauth/callback',
            '/api/threads/deauthorize',
            '/api/threads/data-deletion',
        ];

        for (const path of paths) {
            const response = await head(path);
            expect(response.status).toBe(200);
        }
    });
});
