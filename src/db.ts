import { MongoClient, type Collection, type ObjectId } from 'mongodb';
import type {
    PublishResult,
    ScheduledPublicationStatus,
    Target,
} from '../shared/types';

export interface UserDoc {
    _id?: ObjectId;
    email: string;
    passwordHash: string;
    createdAt: Date;
}

export interface DraftDoc {
    _id?: ObjectId;
    userId: string; // owner (user _id as string)
    title: string;
    markdown: string;
    imageUrls: string[];
    imageIds: string[]; // ids of uploaded images (see UploadDoc)
    targets: Target[];
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
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface PlatformConfigDoc {
    _id?: ObjectId;
    userId: string;
    platform: string;
    values: Record<string, string>;
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
    userId: string;
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
    userId: string;
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
let publicationsColl: Collection<PublicationDoc> | null = null;
let scheduledPublicationsColl: Collection<ScheduledPublicationDoc> | null = null;

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
    publicationsColl = db.collection<PublicationDoc>('publications');
    scheduledPublicationsColl =
        db.collection<ScheduledPublicationDoc>('scheduledPublications');

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
    await publicationsColl.createIndex({ userId: 1, draftId: 1, updatedAt: -1 });
    await scheduledPublicationsColl.createIndex({
        status: 1,
        scheduledAt: 1,
    });
    await scheduledPublicationsColl.createIndex({
        userId: 1,
        scheduledAt: 1,
    });

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
