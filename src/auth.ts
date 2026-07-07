import { SignJWT, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
import {
    accountMembers,
    users,
    FULL_ACCESS_PERMISSIONS,
    type MemberPermissions,
    type UserDoc,
} from './db';
import { createEmailVerification } from './emailVerification';

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'change-me-in-production',
);
const JWT_ALG = 'HS256';
const JWT_EXPIRY = '7d';

export interface AuthUser {
    id: string;
    email: string;
}

/** The resolved identity + workspace a request is acting under. */
export interface ActorContext {
    userId: string;
    email: string;
    accountId: string;
    role: 'owner' | 'member';
    permissions: MemberPermissions;
}

export class AuthError extends Error {
    constructor(
        message: string,
        public status = 400,
    ) {
        super(message);
    }
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

/** Issue a session JWT for an already-authenticated user (used by login/register/invite-accept). */
export async function issueSessionToken(user: AuthUser): Promise<string> {
    return new SignJWT({ email: user.email })
        .setProtectedHeader({ alg: JWT_ALG })
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime(JWT_EXPIRY)
        .sign(JWT_SECRET);
}

export async function registerUser(
    email: string,
    password: string,
): Promise<{ token: string; user: AuthUser }> {
    const normalized = normalizeEmail(email || '');
    if (!normalized || !normalized.includes('@')) {
        throw new AuthError('A valid email is required');
    }
    if (!password || password.length < 6) {
        throw new AuthError('Password must be at least 6 characters');
    }

    const existing = await users().findOne({ email: normalized });
    if (existing) {
        throw new AuthError('An account with this email already exists', 409);
    }

    const passwordHash = await Bun.password.hash(password);
    const doc: UserDoc = {
        email: normalized,
        passwordHash,
        emailVerified: false,
        createdAt: new Date(),
    };
    const result = await users().insertOne(doc);
    const user: AuthUser = { id: result.insertedId.toString(), email: normalized };

    try {
        await createEmailVerification(user.id, normalized);
    } catch (error) {
        console.error('Failed to send verification email:', error);
    }

    return { token: await issueSessionToken(user), user };
}

export async function loginUser(
    email: string,
    password: string,
): Promise<{ token: string; user: AuthUser }> {
    const normalized = normalizeEmail(email || '');
    const doc = await users().findOne({ email: normalized });
    if (!doc) throw new AuthError('Invalid email or password', 401);

    const valid = await Bun.password.verify(password || '', doc.passwordHash);
    if (!valid) throw new AuthError('Invalid email or password', 401);

    const user: AuthUser = { id: doc._id!.toString(), email: doc.email };
    return { token: await issueSessionToken(user), user };
}

export async function changePassword(
    actor: ActorContext,
    currentPassword: string,
    newPassword: string,
): Promise<void> {
    if (!ObjectId.isValid(actor.userId)) throw new AuthError('User not found', 404);
    const user = await users().findOne({ _id: new ObjectId(actor.userId) });
    if (!user) throw new AuthError('User not found', 404);

    const valid = await Bun.password.verify(currentPassword || '', user.passwordHash);
    if (!valid) throw new AuthError('Invalid password', 401);

    if (!newPassword || newPassword.length < 6) {
        throw new AuthError('Password must be at least 6 characters');
    }

    const passwordHash = await Bun.password.hash(newPassword);
    await users().updateOne({ _id: user._id }, { $set: { passwordHash } });
}

async function verifyToken(req: Request, tokenOverride?: string): Promise<AuthUser> {
    const header = req.headers.get('authorization') || '';
    const headerToken = header.startsWith('Bearer ') ? header.slice(7) : '';
    const token = tokenOverride || headerToken;
    if (!token) throw new AuthError('Authentication required', 401);

    try {
        const { payload } = await jwtVerify(token, JWT_SECRET, {
            algorithms: [JWT_ALG],
        });
        const id = payload.sub;
        if (!id || !ObjectId.isValid(id)) {
            throw new AuthError('Invalid token', 401);
        }
        return { id, email: String(payload.email || '') };
    } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError('Invalid or expired token', 401);
    }
}

/**
 * Verify the Bearer token and resolve the workspace the caller acts under: the
 * account owner themselves, or — if their userId has an active membership on
 * someone else's account — that account with their granted permissions.
 * A user is either an owner of their own account or a member of exactly one
 * other account, never both (see plan's v1 single-membership simplification).
 */
export async function requireAuth(
    req: Request,
    options?: { tokenOverride?: string },
): Promise<ActorContext> {
    // A WebSocket handshake can't set an Authorization header, so the live-view route
    // passes the session token as a `?token=` query param instead — verified identically.
    const user = await verifyToken(req, options?.tokenOverride);

    const membership = await accountMembers().findOne({
        userId: user.id,
        status: 'active',
    });

    if (membership) {
        return {
            userId: user.id,
            email: user.email,
            accountId: membership.accountId,
            role: 'member',
            permissions: membership.permissions,
        };
    }

    return {
        userId: user.id,
        email: user.email,
        accountId: user.id,
        role: 'owner',
        permissions: FULL_ACCESS_PERMISSIONS,
    };
}
