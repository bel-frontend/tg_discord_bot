import { MongoClient, type Collection, type ObjectId } from 'mongodb';
import type {
    AccountMemberStatus,
    MemberPermissions,
    PublishResult,
    ScheduledPublicationStatus,
    Target,
} from '../shared/types';

export type { MemberPermissions } from '../shared/types';
export { FULL_ACCESS_PERMISSIONS } from '../shared/types';

export interface UserDoc {
    _id?: ObjectId;
    email: string;
    passwordHash: string;
    emailVerified: boolean;
    emailVerifiedAt?: Date;
    createdAt: Date;
}

export interface AccountMemberDoc {
    _id?: ObjectId;
    accountId: string; // owner's userId — the workspace this membership grants access to
    userId?: string; // member's own userId, set once the invite is accepted
    email: string; // normalized invite email
    permissions: MemberPermissions;
    status: AccountMemberStatus;
    inviteTokenHash?: string;
    inviteExpiresAt?: Date;
    invitedBy: string;
    invitedAt: Date;
    acceptedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface EmailVerificationDoc {
    _id?: ObjectId;
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    consumedAt?: Date;
}

export interface PasswordResetDoc {
    _id?: ObjectId;
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    consumedAt?: Date;
}

export interface EmailChangeDoc {
    _id?: ObjectId;
    userId: string;
    currentEmail: string;
    newEmail: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    consumedAt?: Date;
}

export interface DraftDoc {
    _id?: ObjectId;
    userId: string; // owner (user _id as string)
    title: string;
    markdown: string;
    imageUrls: string[];
    imageIds: string[]; // ids of uploaded images (see UploadDoc)
    targets: Target[];
    silent: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface UploadDoc {
    _id?: ObjectId;
    userId: string;
    filename: string;
    contentType: string;
    data: Buffer;
    size: number;
    createdAt: Date;
}

export interface ChannelResourceDoc {
    _id?: ObjectId;
    platform: string;
    channelId: string;
    name: string;
    createdBy: string; // account id (workspace-shared resource, not per-member)
    createdAt: Date;
    updatedAt: Date;
}

export interface PlatformConfigDoc {
    _id?: ObjectId;
    userId: string; // account id — bot/platform credentials are shared across the account
    platform: string;
    values: Record<string, string>;
    createdAt: Date;
    updatedAt: Date;
}

// Kept separate from PlatformConfigDoc: this holds an encrypted browser login
// session (cookies/local storage), a strictly more sensitive artifact than the
// plaintext credential bag above — a leaked session is full account takeover.
export interface BrowserSessionDoc {
    _id?: ObjectId;
    accountId: string; // workspace whose browser session this is
    platform: string; // 'x' | 'reddit' | ...
    encryptedState: {
        ciphertext: string;
        iv: string;
        authTag: string;
    };
    status: 'connected' | 'reconnect_required';
    lastPublishedAt?: Date;
    lastVerifiedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface PublicationTargetDoc {
    platform: string;
    channelId: string;
    messageIds: string[];
    ok: boolean;
    error?: string;
    updatedAt: Date;
    link?: string;
}

export interface PublicationDoc {
    _id?: ObjectId;
    userId: string; // account id — publication history is shared across the account
    draftId: string;
    title: string;
    markdown: string;
    imageUrls: string[];
    targets: PublicationTargetDoc[];
    createdAt: Date;
    updatedAt: Date;
}

export interface ScheduledPublicationDoc {
    _id?: ObjectId;
    userId: string; // author — the draft/images this schedules are private to this member
    accountId: string; // workspace to publish under (platform configs, publication history)
    draftId: string;
    title: string;
    scheduledAt: Date;
    status: ScheduledPublicationStatus;
    error?: string;
    results?: PublishResult[];
    publicationId?: string;
    createdAt: Date;
    updatedAt: Date;
}

let client: MongoClient | null = null;
let usersColl: Collection<UserDoc> | null = null;
let draftsColl: Collection<DraftDoc> | null = null;
let uploadsColl: Collection<UploadDoc> | null = null;
let channelResourcesColl: Collection<ChannelResourceDoc> | null = null;
let platformConfigsColl: Collection<PlatformConfigDoc> | null = null;
let browserSessionsColl: Collection<BrowserSessionDoc> | null = null;
let publicationsColl: Collection<PublicationDoc> | null = null;
let scheduledPublicationsColl: Collection<ScheduledPublicationDoc> | null = null;
let accountMembersColl: Collection<AccountMemberDoc> | null = null;
let emailVerificationsColl: Collection<EmailVerificationDoc> | null = null;
let passwordResetsColl: Collection<PasswordResetDoc> | null = null;
let emailChangesColl: Collection<EmailChangeDoc> | null = null;

export function resolveMongoConfig(
    env: Record<string, string | undefined> = process.env,
): {
    uri: string;
    dbName: string;
} {
    const explicitUri = env.MONGODB_URI?.trim();
    const explicitDbName = env.MONGODB_DB?.trim();
    if (explicitUri) {
        const uriDbName = new URL(explicitUri).pathname.replace(/^\//, '');
        return {
            uri: explicitUri,
            dbName: explicitDbName || uriDbName || 'tg_discord_bot',
        };
    }

    const password = env.MONGODB_PASSWORD;
    if (!password) throw new Error('Missing MONGODB_PASSWORD');

    const user = env.MONGODB_USER || 'admin';
    const host = env.MONGODB_HOST || '10.8.0.34';
    const port = env.MONGODB_PORT || '27028';
    const dbName = explicitDbName || 'composer';
    const authSource = env.MONGODB_AUTH_SOURCE || 'admin';
    const replicaSet = env.MONGODB_REPLICA_SET || 'rs8';
    const query = new URLSearchParams({ authSource, replicaSet });

    return {
        uri: `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(
            password,
        )}@${host}:${port}/${dbName}?${query.toString()}`,
        dbName,
    };
}

export async function connect(): Promise<void> {
    if (client) return;

    const { uri, dbName } = resolveMongoConfig();

    // promoteBuffers so stored binary (uploaded images) reads back as Buffer, not Binary.
    client = new MongoClient(uri, { promoteBuffers: true });
    await client.connect();

    const db = client.db(dbName);
    usersColl = db.collection<UserDoc>('users');
    draftsColl = db.collection<DraftDoc>('drafts');
    uploadsColl = db.collection<UploadDoc>('uploads');
    channelResourcesColl =
        db.collection<ChannelResourceDoc>('channelResources');
    platformConfigsColl = db.collection<PlatformConfigDoc>('platformConfigs');
    browserSessionsColl =
        db.collection<BrowserSessionDoc>('browserSessions');
    publicationsColl = db.collection<PublicationDoc>('publications');
    scheduledPublicationsColl =
        db.collection<ScheduledPublicationDoc>('scheduledPublications');
    accountMembersColl = db.collection<AccountMemberDoc>('accountMembers');
    emailVerificationsColl =
        db.collection<EmailVerificationDoc>('emailVerifications');
    passwordResetsColl = db.collection<PasswordResetDoc>('passwordResets');
    emailChangesColl = db.collection<EmailChangeDoc>('emailChanges');

    await usersColl.createIndex({ email: 1 }, { unique: true });
    await draftsColl.createIndex({ userId: 1, updatedAt: -1 });
    await uploadsColl.createIndex({ userId: 1, createdAt: -1 });
    try {
        await channelResourcesColl.dropIndex('platform_1_channelId_1');
    } catch {
        // Older installs may not have this global uniqueness index.
    }
    await channelResourcesColl.createIndex(
        { createdBy: 1, platform: 1, channelId: 1 },
        { unique: true },
    );
    await platformConfigsColl.createIndex(
        { userId: 1, platform: 1 },
        { unique: true },
    );
    await browserSessionsColl.createIndex(
        { accountId: 1, platform: 1 },
        { unique: true },
    );
    await publicationsColl.createIndex({ userId: 1, draftId: 1, updatedAt: -1 });
    await scheduledPublicationsColl.createIndex({
        status: 1,
        scheduledAt: 1,
    });
    await scheduledPublicationsColl.createIndex({
        userId: 1,
        scheduledAt: 1,
    });
    await scheduledPublicationsColl.createIndex({ accountId: 1, scheduledAt: 1 });

    await accountMembersColl.createIndex(
        { accountId: 1, email: 1 },
        { unique: true },
    );
    await accountMembersColl.createIndex(
        { userId: 1 },
        { unique: true, sparse: true },
    );
    await accountMembersColl.createIndex(
        { inviteTokenHash: 1 },
        { unique: true, sparse: true },
    );
    await emailVerificationsColl.createIndex({ tokenHash: 1 }, { unique: true });
    await emailVerificationsColl.createIndex({ userId: 1 });
    await passwordResetsColl.createIndex({ tokenHash: 1 }, { unique: true });
    await passwordResetsColl.createIndex({ userId: 1 });
    await emailChangesColl.createIndex({ tokenHash: 1 }, { unique: true });
    await emailChangesColl.createIndex({ userId: 1 });

    // One-time idempotent backfills — this project has no migration system, so
    // schema additions are applied on every connect() and are no-ops once done.
    await usersColl.updateMany(
        { emailVerified: { $exists: false } },
        { $set: { emailVerified: true } },
    );
    await scheduledPublicationsColl.updateMany(
        { accountId: { $exists: false } },
        [{ $set: { accountId: '$userId' } }],
    );

    console.log(`Connected to MongoDB (db: ${dbName}).`);
}

export function users(): Collection<UserDoc> {
    if (!usersColl) throw new Error('DB not connected — call connect() first');
    return usersColl;
}

export function drafts(): Collection<DraftDoc> {
    if (!draftsColl) throw new Error('DB not connected — call connect() first');
    return draftsColl;
}

export function uploads(): Collection<UploadDoc> {
    if (!uploadsColl) throw new Error('DB not connected — call connect() first');
    return uploadsColl;
}

export function channelResources(): Collection<ChannelResourceDoc> {
    if (!channelResourcesColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return channelResourcesColl;
}

export function platformConfigs(): Collection<PlatformConfigDoc> {
    if (!platformConfigsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return platformConfigsColl;
}

export function browserSessions(): Collection<BrowserSessionDoc> {
    if (!browserSessionsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return browserSessionsColl;
}

export function publications(): Collection<PublicationDoc> {
    if (!publicationsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return publicationsColl;
}

export function scheduledPublications(): Collection<ScheduledPublicationDoc> {
    if (!scheduledPublicationsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return scheduledPublicationsColl;
}

export function accountMembers(): Collection<AccountMemberDoc> {
    if (!accountMembersColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return accountMembersColl;
}

export function emailVerifications(): Collection<EmailVerificationDoc> {
    if (!emailVerificationsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return emailVerificationsColl;
}

export function passwordResets(): Collection<PasswordResetDoc> {
    if (!passwordResetsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return passwordResetsColl;
}

export function emailChanges(): Collection<EmailChangeDoc> {
    if (!emailChangesColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return emailChangesColl;
}
