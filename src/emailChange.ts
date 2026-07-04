import { createHash, randomBytes } from 'crypto';
import { ObjectId, type MongoServerError } from 'mongodb';
import { emailChanges, users, type EmailChangeDoc } from './db';
import { sendEmailChangeEmail } from './email';
import { AuthError, type ActorContext } from './auth';

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

export async function requestEmailChange(
    actor: ActorContext,
    newEmail: string,
    currentPassword: string,
): Promise<void> {
    if (!ObjectId.isValid(actor.userId)) throw new AuthError('User not found', 404);
    const user = await users().findOne({ _id: new ObjectId(actor.userId) });
    if (!user) throw new AuthError('User not found', 404);

    const valid = await Bun.password.verify(currentPassword || '', user.passwordHash);
    if (!valid) throw new AuthError('Invalid password', 401);

    const normalized = normalizeEmail(newEmail);
    if (!normalized || !normalized.includes('@')) {
        throw new AuthError('A valid email is required');
    }
    if (normalized === normalizeEmail(user.email)) {
        throw new AuthError('That is already your email');
    }

    const existing = await users().findOne({ email: normalized });
    if (existing) {
        throw new AuthError('That email is already in use', 409);
    }

    const token = generateToken();
    const now = new Date();
    const doc: EmailChangeDoc = {
        userId: actor.userId,
        currentEmail: user.email,
        newEmail: normalized,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
        createdAt: now,
    };
    await emailChanges().insertOne(doc);
    await sendEmailChangeEmail(normalized, {
        confirmUrl: `${baseUrl()}/confirm-email-change/${token}`,
        currentEmail: user.email,
    });
}

export async function confirmEmailChange(token: string): Promise<{ email: string }> {
    const doc = await emailChanges().findOne({ tokenHash: hashToken(token) });
    if (!doc || doc.consumedAt || doc.expiresAt.getTime() < Date.now()) {
        throw new AuthError('This confirmation link is invalid or has expired', 400);
    }

    const existing = await users().findOne({ email: doc.newEmail });
    if (existing) {
        throw new AuthError('That email is already in use', 409);
    }

    try {
        await users().updateOne(
            { _id: new ObjectId(doc.userId) },
            {
                $set: {
                    email: doc.newEmail,
                    emailVerified: true,
                    emailVerifiedAt: new Date(),
                },
            },
        );
    } catch (error) {
        if ((error as MongoServerError)?.code === 11000) {
            throw new AuthError('That email is already in use', 409);
        }
        throw error;
    }

    await emailChanges().updateOne(
        { _id: doc._id },
        { $set: { consumedAt: new Date() } },
    );

    return { email: doc.newEmail };
}
