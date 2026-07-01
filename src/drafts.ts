import { ObjectId } from 'mongodb';
import { drafts, type DraftDoc, type DraftTarget } from './db';

export interface DraftInput {
    title?: string;
    markdown?: string;
    imageUrls?: string[];
    targets?: DraftTarget[];
}

function serialize(doc: DraftDoc) {
    return {
        id: doc._id!.toString(),
        title: doc.title,
        markdown: doc.markdown,
        imageUrls: doc.imageUrls,
        targets: doc.targets,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
}

function sanitize(input: DraftInput): {
    title: string;
    markdown: string;
    imageUrls: string[];
    targets: DraftTarget[];
} {
    return {
        title: (input.title ?? 'Untitled').toString().slice(0, 200),
        markdown: (input.markdown ?? '').toString(),
        imageUrls: Array.isArray(input.imageUrls)
            ? input.imageUrls.map(String)
            : [],
        targets: Array.isArray(input.targets)
            ? input.targets
                  .filter((t) => t && t.platform && t.channelId)
                  .map((t) => ({
                      platform: String(t.platform),
                      channelId: String(t.channelId),
                  }))
            : [],
    };
}

export async function listDrafts(userId: string) {
    const docs = await drafts()
        .find({ userId })
        .sort({ updatedAt: -1 })
        .toArray();
    return docs.map(serialize);
}

export async function getDraft(userId: string, id: string) {
    if (!ObjectId.isValid(id)) return null;
    const doc = await drafts().findOne({ _id: new ObjectId(id), userId });
    return doc ? serialize(doc) : null;
}

export async function createDraft(userId: string, input: DraftInput) {
    const now = new Date();
    const doc: DraftDoc = {
        userId,
        ...sanitize(input),
        createdAt: now,
        updatedAt: now,
    };
    const result = await drafts().insertOne(doc);
    doc._id = result.insertedId;
    return serialize(doc);
}

export async function updateDraft(
    userId: string,
    id: string,
    input: DraftInput,
) {
    if (!ObjectId.isValid(id)) return null;
    const result = await drafts().findOneAndUpdate(
        { _id: new ObjectId(id), userId },
        { $set: { ...sanitize(input), updatedAt: new Date() } },
        { returnDocument: 'after' },
    );
    return result ? serialize(result) : null;
}

export async function deleteDraft(userId: string, id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await drafts().deleteOne({ _id: new ObjectId(id), userId });
    return result.deletedCount > 0;
}
