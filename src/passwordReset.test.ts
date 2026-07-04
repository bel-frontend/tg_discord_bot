import { describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';

const userId = new ObjectId();
const existingUser = {
    _id: userId,
    email: 'user@example.com',
    passwordHash: 'old-hash',
    emailVerified: true,
    createdAt: new Date(),
};

let storedReset: any = null;
const usersUpdateOne = mock(async () => ({ matchedCount: 1, modifiedCount: 1 }));

const usersCollection = {
    findOne: mock(async ({ email }: { email?: string }) =>
        email && email === existingUser.email ? existingUser : null,
    ),
    updateOne: usersUpdateOne,
};

const passwordResetsCollection = {
    insertOne: mock(async (doc: any) => {
        storedReset = { ...doc, _id: new ObjectId() };
        return { insertedId: storedReset._id };
    }),
    findOne: mock(async ({ tokenHash }: { tokenHash: string }) =>
        storedReset && storedReset.tokenHash === tokenHash ? storedReset : null,
    ),
    updateOne: mock(async (_filter: any, update: any) => {
        Object.assign(storedReset, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
    }),
};

const sendPasswordResetEmail = mock(
    async (_to: string, _params: { resetUrl: string }) => {},
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
    passwordResets: () => passwordResetsCollection,
    emailChanges: emptyCollection,
    channelResources: emptyCollection,
    drafts: emptyCollection,
    uploads: emptyCollection,
    platformConfigs: emptyCollection,
    publications: emptyCollection,
    scheduledPublications: emptyCollection,
}));

mock.module('./email', () => ({
    sendInviteEmail: mock(async () => {}),
    sendVerificationEmail: mock(async () => {}),
    sendPasswordResetEmail,
    sendEmailChangeEmail: mock(async () => {}),
}));

const { requestPasswordReset, resetPassword } = await import('./passwordReset');

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

describe('requestPasswordReset', () => {
    test('does nothing for an unknown email', async () => {
        await requestPasswordReset('nobody@example.com');
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    test('creates a reset token and emails it for a known email', async () => {
        await requestPasswordReset('USER@example.com');
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
        const [to, { resetUrl }] = sendPasswordResetEmail.mock.calls[0];
        expect(to).toBe('user@example.com');
        const token = resetUrl.split('/').pop()!;
        expect(storedReset.tokenHash).toBe(hashToken(token));
    });
});

describe('resetPassword', () => {
    test('rejects an unknown token', async () => {
        await expect(resetPassword('bogus', 'newpassword')).rejects.toThrow(
            /invalid or has expired/,
        );
    });

    test('rejects a short password', async () => {
        await requestPasswordReset('user@example.com');
        const [, { resetUrl }] = sendPasswordResetEmail.mock.calls.at(-1)!;
        const token = resetUrl.split('/').pop()!;
        await expect(resetPassword(token, 'short')).rejects.toThrow(
            /at least 6 characters/,
        );
    });

    test('resets the password and issues a session for a valid token', async () => {
        await requestPasswordReset('user@example.com');
        const [, { resetUrl }] = sendPasswordResetEmail.mock.calls.at(-1)!;
        const token = resetUrl.split('/').pop()!;

        const result = await resetPassword(token, 'newpassword123');

        expect(result.user).toEqual({ id: userId.toString(), email: existingUser.email });
        expect(typeof result.token).toBe('string');
        expect(usersUpdateOne).toHaveBeenCalled();
        expect(storedReset.consumedAt).toBeInstanceOf(Date);

        await expect(resetPassword(token, 'anotherpassword')).rejects.toThrow(
            /invalid or has expired/,
        );
    });
});
