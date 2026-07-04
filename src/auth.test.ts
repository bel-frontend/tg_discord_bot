import { describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';

const userId = new ObjectId();
const existingUser = {
    _id: userId,
    email: 'user@example.com',
    passwordHash: await Bun.password.hash('correct-password'),
    emailVerified: true,
    createdAt: new Date(),
};

const usersUpdateOne = mock(
    async (_filter: any, _update: { $set: { passwordHash: string } }) => ({
        matchedCount: 1,
        modifiedCount: 1,
    }),
);
const usersCollection = {
    findOne: mock(async ({ _id }: { _id: ObjectId }) =>
        _id.toString() === userId.toString() ? existingUser : null,
    ),
    updateOne: usersUpdateOne,
};

const emptyCollection = () => ({
    findOne: mock(async () => null),
    find: mock(() => ({ toArray: async () => [] })),
    insertOne: mock(async () => ({ insertedId: 'id' })),
    updateOne: mock(async () => ({ matchedCount: 0, modifiedCount: 0 })),
});

// `mock.module` replaces a module for the whole test run, not just this file, so
// this mock must cover every named export any test file's import graph needs
// from `./db` (see the equivalent full list in src/server.test.ts).
mock.module('./db', () => ({
    FULL_ACCESS_PERMISSIONS: {
        canPublish: true,
        canManageResources: true,
        canManagePlatforms: true,
        canManageMembers: true,
        channelAccess: 'all',
    },
    users: () => usersCollection,
    accountMembers: emptyCollection,
    emailVerifications: emptyCollection,
    passwordResets: emptyCollection,
    emailChanges: emptyCollection,
    channelResources: emptyCollection,
    drafts: emptyCollection,
    uploads: emptyCollection,
    platformConfigs: emptyCollection,
    publications: emptyCollection,
    scheduledPublications: emptyCollection,
}));

const { changePassword } = await import('./auth');

const actor = {
    userId: userId.toString(),
    email: existingUser.email,
    accountId: userId.toString(),
    role: 'owner' as const,
    permissions: {} as any,
};

describe('changePassword', () => {
    test('rejects the wrong current password', async () => {
        await expect(
            changePassword(actor, 'wrong-password', 'newpassword123'),
        ).rejects.toThrow(/Invalid password/);
    });

    test('rejects a new password shorter than 6 characters', async () => {
        await expect(
            changePassword(actor, 'correct-password', 'short'),
        ).rejects.toThrow(/at least 6 characters/);
    });

    test('updates the password hash on success', async () => {
        await changePassword(actor, 'correct-password', 'newpassword123');
        expect(usersUpdateOne).toHaveBeenCalled();
        const [, update] = usersUpdateOne.mock.calls.at(-1)!;
        const valid = await Bun.password.verify(
            'newpassword123',
            update.$set.passwordHash,
        );
        expect(valid).toBe(true);
    });
});
