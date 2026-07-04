import { describe, expect, mock, test } from 'bun:test';

let stored: any = null;

const platformConfigsCollection = {
    findOne: mock(async () => stored),
    find: mock(() => ({
        toArray: async () => (stored ? [stored] : []),
    })),
    findOneAndUpdate: mock(async (_filter: any, update: any) => {
        stored = {
            userId: update.$setOnInsert.userId,
            platform: update.$setOnInsert.platform,
            values: update.$set.values,
            createdAt: update.$setOnInsert.createdAt,
            updatedAt: update.$set.updatedAt,
        };
        return stored;
    }),
};

const emptyCollection = () => ({
    findOne: mock(async () => null),
    find: mock(() => ({
        toArray: async () => [],
    })),
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
    users: emptyCollection,
    accountMembers: emptyCollection,
    emailVerifications: emptyCollection,
    passwordResets: emptyCollection,
    emailChanges: emptyCollection,
    channelResources: emptyCollection,
    drafts: emptyCollection,
    uploads: emptyCollection,
    platformConfigs: () => platformConfigsCollection,
    publications: emptyCollection,
    scheduledPublications: emptyCollection,
}));

mock.module('./platforms/registry', () => ({
    getPlatform: mock(() => ({
        setup: {
            configFields: [
                {
                    name: 'TOKEN',
                    label: 'Token',
                    required: true,
                    secret: true,
                    description: 'Secret token',
                },
                {
                    name: 'PROFILE_ID',
                    label: 'Profile id',
                    required: true,
                    description: 'Profile id',
                },
            ],
        },
    })),
    listPlatforms: mock(() => [
        {
            id: 'unit',
        },
    ]),
}));

const { listPlatformConfigs, upsertPlatformConfig } = await import(
    './platformConfigs'
);

describe('platform config storage', () => {
    test('hides secrets and preserves an existing secret when submitted blank', async () => {
        stored = null;

        const first = await upsertPlatformConfig('user1', 'unit', {
            TOKEN: 'secret',
            PROFILE_ID: 'profile-1',
        });

        expect(first.values).toEqual({ PROFILE_ID: 'profile-1' });
        expect(first.configuredSecrets).toEqual(['TOKEN']);

        const second = await upsertPlatformConfig('user1', 'unit', {
            TOKEN: '',
            PROFILE_ID: 'profile-2',
        });

        expect(stored.values).toEqual({
            TOKEN: 'secret',
            PROFILE_ID: 'profile-2',
        });
        expect(second.values).toEqual({ PROFILE_ID: 'profile-2' });

        const [listed] = await listPlatformConfigs('user1');
        expect(listed.values).toEqual({ PROFILE_ID: 'profile-2' });
        expect(listed.configuredSecrets).toEqual(['TOKEN']);
    });

    test('clearFields removes a saved secret even though it is required', async () => {
        stored = null;
        await upsertPlatformConfig('user1', 'unit', {
            TOKEN: 'secret',
            PROFILE_ID: 'profile-1',
        });

        const cleared = await upsertPlatformConfig('user1', 'unit', {
            clearFields: ['TOKEN'],
        });

        expect(stored.values).toEqual({ PROFILE_ID: 'profile-1' });
        expect(cleared.configuredSecrets).toEqual([]);
    });

    test('clearFields takes precedence even when a replacement value is submitted alongside it', async () => {
        stored = null;
        await upsertPlatformConfig('user1', 'unit', {
            TOKEN: 'secret',
            PROFILE_ID: 'profile-1',
        });

        await upsertPlatformConfig('user1', 'unit', {
            TOKEN: 'should-be-ignored',
            clearFields: ['TOKEN'],
        });

        expect(stored.values).toEqual({ PROFILE_ID: 'profile-1' });
    });
});
