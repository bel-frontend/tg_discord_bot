import { SignJWT, jwtVerify } from 'jose';
import { ObjectId } from 'mongodb';
import { users, type UserDoc } from './db';

const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'change-me-in-production',
);
const JWT_ALG = 'HS256';
const JWT_EXPIRY = '7d';

export interface AuthUser {
    id: string;
    email: string;
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

async function signToken(user: AuthUser): Promise<string> {
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
        createdAt: new Date(),
    };
    const result = await users().insertOne(doc);
    const user: AuthUser = { id: result.insertedId.toString(), email: normalized };
    return { token: await signToken(user), user };
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
    return { token: await signToken(user), user };
}

/** Verify the Bearer token on a request and return the user, or throw AuthError(401). */
export async function requireAuth(req: Request): Promise<AuthUser> {
    const header = req.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
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
