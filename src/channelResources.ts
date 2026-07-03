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

export async function listChannelResources(
    userId: string,
): Promise<ChannelResource[]> {
    const docs = await channelResources()
        .find({ createdBy: userId })
        .sort({ platform: 1, name: 1 })
        .toArray();
    return docs.map(serialize);
}

export async function createChannelResource(
    userId: string,
    input: ChannelResourceInput,
): Promise<ChannelResource> {
    const now = new Date();
    const sanitized = sanitize(input);
    const doc: ChannelResourceDoc = {
        ...sanitized,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
    };

    try {
        const existing = await channelResources().findOneAndUpdate(
            {
                createdBy: userId,
                platform: sanitized.platform,
                channelId: sanitized.channelId,
            },
            {
                $set: {
                    name: sanitized.name,
                    updatedAt: now,
                },
                $setOnInsert: {
                    platform: sanitized.platform,
                    channelId: sanitized.channelId,
                    createdBy: userId,
                    createdAt: now,
                },
            },
            {
                upsert: true,
                returnDocument: 'after',
            },
        );

        if (!existing) {
            throw new Error('Failed to save channel resource');
        }
        return serialize(existing);
    } catch (error: any) {
        if (error?.code === 11000) {
            throw new Error('This channel is already configured by another write');
        }
        throw error;
    }
}

export async function updateChannelResource(
    userId: string,
    id: string,
    input: ChannelResourceInput,
): Promise<ChannelResource | null> {
    if (!ObjectId.isValid(id)) return null;

    try {
        const doc = await channelResources().findOneAndUpdate(
            { _id: new ObjectId(id), createdBy: userId },
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

export async function deleteChannelResource(
    userId: string,
    id: string,
): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await channelResources().deleteOne({
        _id: new ObjectId(id),
        createdBy: userId,
    });
    return result.deletedCount > 0;
}
