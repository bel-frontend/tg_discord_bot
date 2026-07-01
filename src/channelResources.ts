import { ObjectId } from 'mongodb';
import { channelResources, type ChannelResourceDoc } from './db';

export interface ChannelResourceInput {
    platform?: string;
    channelId?: string;
    name?: string;
}

export interface ChannelResource {
    resourceId: string;
    platform: string;
    channelId: string;
    id: string;
    name: string;
    source: 'db';
    createdAt: Date;
    updatedAt: Date;
}

function normalizePlatform(platform: string): string {
    return platform.trim().toLowerCase();
}

function sanitize(input: ChannelResourceInput) {
    const platform = normalizePlatform(String(input.platform ?? ''));
    const channelId = String(input.channelId ?? '').trim();
    const name = String(input.name ?? '').trim();

    if (!platform) throw new Error('Platform is required');
    if (!channelId) throw new Error('Channel ID is required');
    if (!name) throw new Error('Channel name is required');

    return { platform, channelId, name };
}

function serialize(doc: ChannelResourceDoc): ChannelResource {
    return {
        resourceId: doc._id!.toString(),
        platform: doc.platform,
        channelId: doc.channelId,
        id: doc.channelId,
        name: doc.name,
        source: 'db',
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

export async function listChannelResources(): Promise<ChannelResource[]> {
    const docs = await channelResources()
        .find({})
        .sort({ platform: 1, name: 1 })
        .toArray();
    return docs.map(serialize);
}

export async function createChannelResource(
    userId: string,
    input: ChannelResourceInput,
): Promise<ChannelResource> {
    const now = new Date();
    const doc: ChannelResourceDoc = {
        ...sanitize(input),
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
    };

    try {
        const result = await channelResources().insertOne(doc);
        doc._id = result.insertedId;
        return serialize(doc);
    } catch (error: any) {
        if (error?.code === 11000) {
            throw new Error('This channel is already configured');
        }
        throw error;
    }
}

export async function updateChannelResource(
    id: string,
    input: ChannelResourceInput,
): Promise<ChannelResource | null> {
    if (!ObjectId.isValid(id)) return null;

    try {
        const doc = await channelResources().findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { ...sanitize(input), updatedAt: new Date() } },
            { returnDocument: 'after' },
        );
        return doc ? serialize(doc) : null;
    } catch (error: any) {
        if (error?.code === 11000) {
            throw new Error('This channel is already configured');
        }
        throw error;
    }
}

export async function deleteChannelResource(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await channelResources().deleteOne({
        _id: new ObjectId(id),
    });
    return result.deletedCount > 0;
}
