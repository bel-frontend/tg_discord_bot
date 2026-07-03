import { createHash, randomBytes } from 'crypto';
import { ObjectId } from 'mongodb';
import {
    accountMembers,
    users,
    type AccountMemberDoc,
    type MemberPermissions,
} from './db';
import { AuthError, issueSessionToken, type ActorContext } from './auth';
import { assertPermission, assertPermissionsWithinGrantor } from './permissions';
import { sendInviteEmail } from './email';
import type { MemberSummary } from '../shared/types';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
}

export function sanitizePermissionsInput(input: unknown): MemberPermissions {
    const body = (input && typeof input === 'object' ? input : {}) as Record<
        string,
        unknown
    >;
    const channelAccess =
        body.channelAccess === 'all'
            ? 'all'
            : Array.isArray(body.channelAccess)
              ? body.channelAccess.map(String)
              : [];
    return {
        channelAccess,
        canPublish: Boolean(body.canPublish),
        canDelete: Boolean(body.canDelete),
        canManageChannels: Boolean(body.canManageChannels),
        canManageMembers: Boolean(body.canManageMembers),
    };
}

function generateToken(): string {
    return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function baseUrl(): string {
    return (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function serialize(doc: AccountMemberDoc): MemberSummary {
    return {
        id: doc._id!.toString(),
        email: doc.email,
        status: doc.status,
        permissions: doc.permissions,
        invitedAt: doc.invitedAt.toISOString(),
        acceptedAt: doc.acceptedAt?.toISOString(),
    };
}

async function requireVerifiedOwnerEmail(accountId: string): Promise<void> {
    if (!ObjectId.isValid(accountId)) throw new AuthError('Account not found', 404);
    const owner = await users().findOne({ _id: new ObjectId(accountId) });
    if (!owner?.emailVerified) {
        throw new AuthError(
            'Verify your account email before inviting members',
            403,
        );
    }
}

export async function listMembers(actor: ActorContext): Promise<MemberSummary[]> {
    assertPermission(actor, 'canManageMembers');
    const docs = await accountMembers()
        .find({ accountId: actor.accountId, status: { $in: ['invited', 'active'] } })
        .sort({ createdAt: 1 })
        .toArray();
    return docs.map(serialize);
}

export async function createInvite(
    actor: ActorContext,
    email: string,
    permissions: MemberPermissions,
): Promise<MemberSummary> {
    assertPermission(actor, 'canManageMembers');
    assertPermissionsWithinGrantor(actor, permissions);
    await requireVerifiedOwnerEmail(actor.accountId);

    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) {
        throw new AuthError('A valid email is required');
    }
    const owner = await users().findOne({ _id: new ObjectId(actor.accountId) });
    if (owner && normalizeEmail(owner.email) === normalized) {
        throw new AuthError('That is the account owner\'s own email', 400);
    }

    const existing = await accountMembers().findOne({
        accountId: actor.accountId,
        email: normalized,
    });
    if (existing && existing.status !== 'revoked') {
        throw new AuthError('This email is already a member or has a pending invite', 409);
    }

    const token = generateToken();
    const now = new Date();
    const doc: AccountMemberDoc = {
        accountId: actor.accountId,
        email: normalized,
        permissions,
        status: 'invited',
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        invitedBy: actor.userId,
        invitedAt: now,
        createdAt: now,
        updatedAt: now,
    };

    let result: AccountMemberDoc;
    if (existing) {
        const updated = await accountMembers().findOneAndUpdate(
            { _id: existing._id },
            { $set: doc },
            { returnDocument: 'after' },
        );
        if (!updated) throw new AuthError('Failed to save invite', 500);
        result = updated;
    } else {
        const inserted = await accountMembers().insertOne(doc);
        result = { ...doc, _id: inserted.insertedId };
    }

    await sendInviteEmail(normalized, {
        inviteUrl: `${baseUrl()}/invite/${token}`,
        inviterEmail: actor.email,
    });

    return serialize(result);
}

export async function resendInvite(
    actor: ActorContext,
    memberId: string,
): Promise<MemberSummary> {
    assertPermission(actor, 'canManageMembers');
    if (!ObjectId.isValid(memberId)) throw new AuthError('Not found', 404);

    const token = generateToken();
    const now = new Date();
    const result = await accountMembers().findOneAndUpdate(
        { _id: new ObjectId(memberId), accountId: actor.accountId, status: 'invited' },
        {
            $set: {
                inviteTokenHash: hashToken(token),
                inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
                updatedAt: now,
            },
        },
        { returnDocument: 'after' },
    );
    if (!result) throw new AuthError('Not found', 404);

    await sendInviteEmail(result.email, {
        inviteUrl: `${baseUrl()}/invite/${token}`,
        inviterEmail: actor.email,
    });

    return serialize(result);
}

export async function updateMemberPermissions(
    actor: ActorContext,
    memberId: string,
    permissions: MemberPermissions,
): Promise<MemberSummary> {
    assertPermission(actor, 'canManageMembers');
    assertPermissionsWithinGrantor(actor, permissions);
    if (!ObjectId.isValid(memberId)) throw new AuthError('Not found', 404);

    const result = await accountMembers().findOneAndUpdate(
        { _id: new ObjectId(memberId), accountId: actor.accountId },
        { $set: { permissions, updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
    if (!result) throw new AuthError('Not found', 404);
    return serialize(result);
}

export async function revokeMember(
    actor: ActorContext,
    memberId: string,
): Promise<boolean> {
    assertPermission(actor, 'canManageMembers');
    if (!ObjectId.isValid(memberId)) return false;

    // Clear `userId` so the sparse-unique index slot frees up — otherwise this
    // person could never join (or be re-invited to) any other account again.
    const result = await accountMembers().updateOne(
        { _id: new ObjectId(memberId), accountId: actor.accountId },
        {
            $set: { status: 'revoked', updatedAt: new Date() },
            $unset: { userId: '' },
        },
    );
    return result.matchedCount > 0;
}

export interface InvitePreview {
    email: string;
    accountOwnerEmail: string;
    requiresPassword: boolean; // true when the invited email has no existing account yet
}

export async function getInvitePreview(token: string): Promise<InvitePreview> {
    const doc = await accountMembers().findOne({
        inviteTokenHash: hashToken(token),
        status: 'invited',
    });
    if (!doc || !doc.inviteExpiresAt || doc.inviteExpiresAt.getTime() < Date.now()) {
        throw new AuthError('This invite link is invalid or has expired', 404);
    }
    const owner = await users().findOne({ _id: new ObjectId(doc.accountId) });
    const existingUser = await users().findOne({ email: doc.email });
    return {
        email: doc.email,
        accountOwnerEmail: owner?.email ?? '',
        requiresPassword: !existingUser,
    };
}

/**
 * Accept an invite. If the invited email has no account yet, `password` creates
 * one (email ownership is already proven by the token, so it's marked verified
 * immediately). If the email already has an account, `password` must match it.
 */
export async function acceptInvite(
    token: string,
    password: string,
): Promise<{ token: string; user: { id: string; email: string } }> {
    const doc = await accountMembers().findOne({
        inviteTokenHash: hashToken(token),
        status: 'invited',
    });
    if (!doc || !doc.inviteExpiresAt || doc.inviteExpiresAt.getTime() < Date.now()) {
        throw new AuthError('This invite link is invalid or has expired', 404);
    }

    let userId: string;
    let email: string;
    const existingUser = await users().findOne({ email: doc.email });

    if (existingUser) {
        const valid = await Bun.password.verify(password || '', existingUser.passwordHash);
        if (!valid) throw new AuthError('Invalid password', 401);
        userId = existingUser._id!.toString();
        email = existingUser.email;
    } else {
        if (!password || password.length < 6) {
            throw new AuthError('Password must be at least 6 characters');
        }
        const passwordHash = await Bun.password.hash(password);
        const inserted = await users().insertOne({
            email: doc.email,
            passwordHash,
            emailVerified: true,
            emailVerifiedAt: new Date(),
            createdAt: new Date(),
        });
        userId = inserted.insertedId.toString();
        email = doc.email;
    }

    // A userId can only have one active membership (the sparse-unique index on
    // `userId` enforces this at the DB level too) — give a clean error instead
    // of letting the update below fail with a raw duplicate-key error.
    const existingMembership = await accountMembers().findOne({
        userId,
        status: 'active',
    });
    if (existingMembership) {
        throw new AuthError('This email is already a member of another workspace', 409);
    }

    await accountMembers().updateOne(
        { _id: doc._id },
        {
            $set: {
                userId,
                status: 'active',
                acceptedAt: new Date(),
                updatedAt: new Date(),
            },
            $unset: { inviteTokenHash: '', inviteExpiresAt: '' },
        },
    );

    const user = { id: userId, email };
    return { token: await issueSessionToken(user), user };
}
