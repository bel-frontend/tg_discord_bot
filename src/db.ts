import { MongoClient, type Collection, type ObjectId } from 'mongodb';
import type { Target } from '../shared/types';

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

export interface PublicationTargetDoc {
    platform: string;
    channelId: string;
    messageIds: string[];
    ok: boolean;
    error?: string;
    updatedAt: Date;
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

let client: MongoClient | null = null;
let usersColl: Collection<UserDoc> | null = null;
let draftsColl: Collection<DraftDoc> | null = null;
let uploadsColl: Collection<UploadDoc> | null = null;
let channelResourcesColl: Collection<ChannelResourceDoc> | null = null;
let publicationsColl: Collection<PublicationDoc> | null = null;

export async function connect(): Promise<void> {
    if (client) return;

    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('Missing MONGODB_URI');

    // promoteBuffers so stored binary (uploaded images) reads back as Buffer, not Binary.
    client = new MongoClient(uri, { promoteBuffers: true });
    await client.connect();

    const dbName = process.env.MONGODB_DB || 'tg_discord_bot';
    const db = client.db(dbName);
    usersColl = db.collection<UserDoc>('users');
    draftsColl = db.collection<DraftDoc>('drafts');
    uploadsColl = db.collection<UploadDoc>('uploads');
    channelResourcesColl =
        db.collection<ChannelResourceDoc>('channelResources');
    publicationsColl = db.collection<PublicationDoc>('publications');

    await usersColl.createIndex({ email: 1 }, { unique: true });
    await draftsColl.createIndex({ userId: 1, updatedAt: -1 });
    await uploadsColl.createIndex({ userId: 1, createdAt: -1 });
    await channelResourcesColl.createIndex(
        { platform: 1, channelId: 1 },
        { unique: true },
    );
    await publicationsColl.createIndex({ userId: 1, draftId: 1, updatedAt: -1 });

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

export function publications(): Collection<PublicationDoc> {
    if (!publicationsColl) {
        throw new Error('DB not connected — call connect() first');
    }
    return publicationsColl;
}
