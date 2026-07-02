import { ObjectId } from 'mongodb';
import { publications, type PublicationDoc } from './db';
import type { PublishResult } from './platforms/types';

export interface PublicationInput {
    draftId: string;
    title: string;
    markdown: string;
    imageUrls: string[];
    results: PublishResult[];
}

function serialize(doc: PublicationDoc) {
    return {
        id: doc._id!.toString(),
        draftId: doc.draftId,
        title: doc.title,
        markdown: doc.markdown,
        imageUrls: doc.imageUrls,
        targets: doc.targets,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

function resultsToTargets(results: PublishResult[]) {
    const now = new Date();
    return results.map((result) => ({
        platform: result.platform,
        channelId: result.channelId,
        messageIds: result.messageIds ?? [],
        ok: result.ok,
        error: result.error,
        updatedAt: now,
    }));
}

export async function listPublications(userId: string, draftId?: string) {
    const filter = draftId ? { userId, draftId } : { userId };
    const docs = await publications()
        .find(filter)
        .sort({ updatedAt: -1 })
        .toArray();
    return docs.map(serialize);
}

export async function getPublication(userId: string, id: string) {
    if (!ObjectId.isValid(id)) return null;
    const doc = await publications().findOne({
        _id: new ObjectId(id),
        userId,
    });
    return doc ? serialize(doc) : null;
}

export async function createPublication(
    userId: string,
    input: PublicationInput,
) {
    const now = new Date();
    const doc: PublicationDoc = {
        userId,
        draftId: input.draftId,
        title: input.title,
        markdown: input.markdown,
        imageUrls: input.imageUrls,
        targets: resultsToTargets(input.results),
        createdAt: now,
        updatedAt: now,
    };
    const result = await publications().insertOne(doc);
    doc._id = result.insertedId;
    return serialize(doc);
}

export async function updatePublicationResults(
    userId: string,
    id: string,
    input: Omit<PublicationInput, 'draftId'>,
) {
    if (!ObjectId.isValid(id)) return null;
    const result = await publications().findOneAndUpdate(
        { _id: new ObjectId(id), userId },
        {
            $set: {
                title: input.title,
                markdown: input.markdown,
                imageUrls: input.imageUrls,
                targets: resultsToTargets(input.results),
                updatedAt: new Date(),
            },
        },
        { returnDocument: 'after' },
    );
    return result ? serialize(result) : null;
}

export async function deletePublicationRecord(userId: string, id: string) {
    if (!ObjectId.isValid(id)) return false;
    const result = await publications().deleteOne({
        _id: new ObjectId(id),
        userId,
    });
    return result.deletedCount > 0;
}
