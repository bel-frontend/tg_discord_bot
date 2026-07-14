import { MongoClient, ObjectId, type Collection } from 'mongodb';
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
    folderId?: string | null; // DraftFolderDoc _id as string; null/absent = root
    pinned?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface DraftFolderDoc {
    _id?: ObjectId;
    userId: string; // owner — folders are private per member, like drafts
    name: string;
    order: number; // ascending sort position in the rail
    createdAt: Date;
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

export interface LocalPublisherAgentDoc {
    _id?: ObjectId;
    accountId: string;
    name: string;
    tokenHash: string;
    status: 'active' | 'revoked';
    platforms: string[];
    lastSeenAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface LocalPublisherJobDoc {
    _id?: ObjectId;
    accountId: string;
    platform: 'threads' | 'x';
    operation: 'publish' | 'delete';
    payload: Record<string, unknown>;
    status: 'queued' | 'leased' | 'completed' | 'failed';
    agentId?: string;
    leaseTokenHash?: string;
    leaseExpiresAt?: Date;
    result?: Record<string, unknown>;
    error?: string;
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
    authorId?: string; // member who triggered this publish (added later; older docs may lack it)
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
let draftFoldersColl: Collection<DraftFolderDoc> | null = null;
let uploadsColl: Collection<UploadDoc> | null = null;
let channelResourcesColl: Collection<ChannelResourceDoc> | null = null;
let platformConfigsColl: Collection<PlatformConfigDoc> | null = null;
let localPublisherAgentsColl: Collection<LocalPublisherAgentDoc> | null = null;
let localPublisherJobsColl: Collection<LocalPublisherJobDoc> | null = null;
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
    draftFoldersColl = db.collection<DraftFolderDoc>('draftFolders');
    uploadsColl = db.collection<UploadDoc>('uploads');
    channelResourcesColl =
        db.collection<ChannelResourceDoc>('channelResources');
    platformConfigsColl = db.collection<PlatformConfigDoc>('platformConfigs');
    localPublisherAgentsColl =
        db.collection<LocalPublisherAgentDoc>('localPublisherAgents');
    localPublisherJobsColl =
        db.collection<LocalPublisherJobDoc>('localPublisherJobs');
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
    await draftFoldersColl.createIndex({ userId: 1, order: 1 });
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
    await localPublisherAgentsColl.createIndex({ tokenHash: 1 }, { unique: true });
    await localPublisherAgentsColl.createIndex({ accountId: 1, status: 1 });
    await localPublisherJobsColl.createIndex({
        accountId: 1,
        status: 1,
        createdAt: 1,
    });
    await localPublisherJobsColl.createIndex({ leaseExpiresAt: 1 });
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

/** Batch-resolves user ids to emails, for labeling records with their author. */
export async function getUserEmailsByIds(
    userIds: string[],
): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)].filter((id) => ObjectId.isValid(id));
    if (!ids.length) return new Map();
    const docs = await users()
        .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
        .toArray();
    return new Map(docs.map((doc) => [doc._id!.toString(), doc.email]));
}

export function drafts(): Collection<DraftDoc> {
    if (!draftsColl) throw new Error('DB not connected — call connect() first');
    return draftsColl;
}

export function draftFolders(): Collection<DraftFolderDoc> {
    if (!draftFoldersColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return draftFoldersColl;
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

export function localPublisherAgents(): Collection<LocalPublisherAgentDoc> {
    if (!localPublisherAgentsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return localPublisherAgentsColl;
}

export function localPublisherJobs(): Collection<LocalPublisherJobDoc> {
    if (!localPublisherJobsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return localPublisherJobsColl;
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
