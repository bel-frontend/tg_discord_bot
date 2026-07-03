import { createHash, randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';
import { emailVerifications, users, type EmailVerificationDoc } from './db';
import { sendVerificationEmail } from './email';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function generateToken(): string {
    return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function baseUrl(): string {
    return (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

/** Creates a verification token and emails it. Failures to send are logged, not thrown (see src/email.ts). */
export async function createEmailVerification(
    userId: string,
    email: string,
): Promise<void> {
    const token = generateToken();
    const now = new Date();
    const doc: EmailVerificationDoc = {
        userId,
        email,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        createdAt: now,
    };
    await emailVerifications().insertOne(doc);
    await sendVerificationEmail(email, {
        verifyUrl: `${baseUrl()}/verify-email/${token}`,
    });
}

export async function resendVerification(userId: string): Promise<void> {
    if (!ObjectId.isValid(userId)) throw new Error('User not found');
    const user = await users().findOne({ _id: new ObjectId(userId) });
    if (!user) throw new Error('User not found');
    if (user.emailVerified) throw new Error('Email is already verified');
    await createEmailVerification(userId, user.email);
}

export async function verifyEmailToken(token: string): Promise<{ email: string }> {
    const doc = await emailVerifications().findOne({ tokenHash: hashToken(token) });
    if (!doc || doc.consumedAt || doc.expiresAt.getTime() < Date.now()) {
        throw new Error('This verification link is invalid or has expired');
    }
    await emailVerifications().updateOne(
        { _id: doc._id },
        { $set: { consumedAt: new Date() } },
    );
    await users().updateOne(
        { _id: new ObjectId(doc.userId) },
        { $set: { emailVerified: true, emailVerifiedAt: new Date() } },
    );
    return { email: doc.email };
}
