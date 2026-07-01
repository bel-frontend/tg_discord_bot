import { MongoClient, type Collection, type ObjectId } from 'mongodb';

export interface UserDoc {
    _id?: ObjectId;
    email: string;
    passwordHash: string;
    createdAt: Date;
}

export interface DraftTarget {
    platform: string;
    channelId: string;
}

export interface DraftDoc {
    _id?: ObjectId;
    userId: string; // owner (user _id as string)
    title: string;
    markdown: string;
    imageUrls: string[];
    imageIds: string[]; // ids of uploaded images (see UploadDoc)
    targets: DraftTarget[];
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

let client: MongoClient | null = null;
let usersColl: Collection<UserDoc> | null = null;
let draftsColl: Collection<DraftDoc> | null = null;
let uploadsColl: Collection<UploadDoc> | null = null;

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

    await usersColl.createIndex({ email: 1 }, { unique: true });
    await draftsColl.createIndex({ userId: 1, updatedAt: -1 });
    await uploadsColl.createIndex({ userId: 1, createdAt: -1 });

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
