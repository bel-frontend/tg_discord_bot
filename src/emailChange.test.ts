import { describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';

const userId = new ObjectId();
const existingUser = {
    _id: userId,
    email: 'user@example.com',
    passwordHash: await Bun.password.hash('correct-password'),
    emailVerified: true,
    createdAt: new Date(),
};
const otherUser = {
    _id: new ObjectId(),
    email: 'taken@example.com',
    passwordHash: 'other-hash',
    emailVerified: true,
    createdAt: new Date(),
};

let storedChange: any = null;
const usersUpdateOne = mock(async () => ({ matchedCount: 1, modifiedCount: 1 }));

const usersCollection = {
    findOne: mock(async (filter: any) => {
        if (filter._id) {
            return filter._id.toString() === userId.toString() ? existingUser : null;
        }
        if (filter.email === existingUser.email) return existingUser;
        if (filter.email === otherUser.email) return otherUser;
        return null;
    }),
    updateOne: usersUpdateOne,
};

const emailChangesCollection = {
    insertOne: mock(async (doc: any) => {
        storedChange = { ...doc, _id: new ObjectId() };
        return { insertedId: storedChange._id };
    }),
    findOne: mock(async ({ tokenHash }: { tokenHash: string }) =>
        storedChange && storedChange.tokenHash === tokenHash ? storedChange : null,
    ),
    updateOne: mock(async (_filter: any, update: any) => {
        Object.assign(storedChange, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
    }),
};

const sendEmailChangeEmail = mock(
    async (_to: string, _params: { confirmUrl: string; currentEmail: string }) => {},
);
const emptyCollection = () => ({
    findOne: mock(async () => null),
    find: mock(() => ({ toArray: async () => [] })),
    insertOne: mock(async () => ({ insertedId: 'id' })),
    updateOne: mock(async () => ({ matchedCount: 0, modifiedCount: 0 })),
});

// `mock.module` replaces a module for the whole test run, not just this file, so
// these mocks must cover every named export any test file's import graph needs
// from `./db`/`./email` (see the equivalent full lists in src/server.test.ts).
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
    emailChanges: () => emailChangesCollection,
    channelResources: emptyCollection,
    drafts: emptyCollection,
    uploads: emptyCollection,
    platformConfigs: emptyCollection,
    publications: emptyCollection,
    scheduledPublications: emptyCollection,
    localPublisherAgents: emptyCollection,
    localPublisherJobs: emptyCollection,
}));

mock.module('./email', () => ({
    sendInviteEmail: mock(async () => {}),
    sendVerificationEmail: mock(async () => {}),
    sendPasswordResetEmail: mock(async () => {}),
    sendEmailChangeEmail,
}));

const { confirmEmailChange, requestEmailChange } = await import('./emailChange');

const actor = {
    userId: userId.toString(),
    email: existingUser.email,
    accountId: userId.toString(),
    role: 'owner' as const,
    permissions: {} as any,
};

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

describe('requestEmailChange', () => {
    test('rejects the wrong current password', async () => {
        await expect(
            requestEmailChange(actor, 'new@example.com', 'wrong-password'),
        ).rejects.toThrow(/Invalid password/);
    });

    test('rejects a new email equal to the current one', async () => {
        await expect(
            requestEmailChange(actor, existingUser.email, 'correct-password'),
        ).rejects.toThrow(/already your email/);
    });

    test('rejects a new email already used by another account', async () => {
        await expect(
            requestEmailChange(actor, otherUser.email, 'correct-password'),
        ).rejects.toThrow(/already in use/);
    });

    test('stores a token and emails the new address', async () => {
        await requestEmailChange(actor, 'new@example.com', 'correct-password');
        expect(sendEmailChangeEmail).toHaveBeenCalledTimes(1);
        const [to, { confirmUrl }] = sendEmailChangeEmail.mock.calls[0];
        expect(to).toBe('new@example.com');
        const token = confirmUrl.split('/').pop()!;
        expect(storedChange.tokenHash).toBe(hashToken(token));
        expect(storedChange.currentEmail).toBe(existingUser.email);
    });
});

describe('confirmEmailChange', () => {
    test('rejects an unknown token', async () => {
        await expect(confirmEmailChange('bogus')).rejects.toThrow(
            /invalid or has expired/,
        );
    });

    test('applies the email change for a valid token', async () => {
        await requestEmailChange(actor, 'confirmed@example.com', 'correct-password');
        const [, { confirmUrl }] = sendEmailChangeEmail.mock.calls.at(-1)!;
        const token = confirmUrl.split('/').pop()!;

        const result = await confirmEmailChange(token);

        expect(result.email).toBe('confirmed@example.com');
        expect(usersUpdateOne).toHaveBeenCalled();
        expect(storedChange.consumedAt).toBeInstanceOf(Date);

        await expect(confirmEmailChange(token)).rejects.toThrow(
            /invalid or has expired/,
        );
    });
});
