import { createHash, randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';
import { passwordResets, users, type PasswordResetDoc } from './db';
import { sendPasswordResetEmail } from './email';
import { AuthError, issueSessionToken, type AuthUser } from './auth';

const TOKEN_TTL_MS = 60 * 60 * 1000;

function generateToken(): string {
    return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function baseUrl(): string {
    return (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
}

/**
 * Always resolves without revealing whether the email has an account — the
 * route always responds `{ ok: true }` regardless of what happens here.
 */
export async function requestPasswordReset(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    if (!normalized) return;

    const user = await users().findOne({ email: normalized });
    if (!user) return;

    const token = generateToken();
    const now = new Date();
    const doc: PasswordResetDoc = {
        userId: user._id!.toString(),
        email: normalized,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        createdAt: now,
    };
    await passwordResets().insertOne(doc);
    await sendPasswordResetEmail(normalized, {
        resetUrl: `${baseUrl()}/reset-password/${token}`,
    });
}

export async function resetPassword(
    token: string,
    newPassword: string,
): Promise<{ token: string; user: AuthUser }> {
    const doc = await passwordResets().findOne({ tokenHash: hashToken(token) });
    if (!doc || doc.consumedAt || doc.expiresAt.getTime() < Date.now()) {
        throw new AuthError('This reset link is invalid or has expired', 400);
    }
    if (!newPassword || newPassword.length < 6) {
        throw new AuthError('Password must be at least 6 characters');
    }

    const passwordHash = await Bun.password.hash(newPassword);
    await users().updateOne(
        { _id: new ObjectId(doc.userId) },
        { $set: { passwordHash } },
    );
    await passwordResets().updateOne(
        { _id: doc._id },
        { $set: { consumedAt: new Date() } },
    );

    const user: AuthUser = { id: doc.userId, email: doc.email };
    return { token: await issueSessionToken(user), user };
}
