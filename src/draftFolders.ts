import { ObjectId } from 'mongodb';
import { draftFolders, drafts, type DraftFolderDoc } from './db';
import type { DraftFolder } from '../shared/types';
import { deletePublicationsForDraft } from './publications';
import { deleteScheduledPublicationsForDraft } from './scheduledPublications';

function serialize(doc: DraftFolderDoc): DraftFolder {
    return {
        id: doc._id!.toString(),
        name: doc.name,
        order: doc.order,
        createdAt: doc.createdAt.toISOString(),
    };
}

function sanitizeName(name: unknown): string {
    return String(name ?? '').trim().slice(0, 100) || 'New folder';
}

export async function listDraftFolders(userId: string) {
    const docs = await draftFolders()
        .find({ userId })
        .sort({ order: 1 })
        .toArray();
    return docs.map(serialize);
}

export async function createDraftFolder(userId: string, name: unknown) {
    const last = await draftFolders()
        .find({ userId })
        .sort({ order: -1 })
        .limit(1)
        .toArray();
    const doc: DraftFolderDoc = {
        userId,
        name: sanitizeName(name),
        order: (last[0]?.order ?? -1) + 1,
        createdAt: new Date(),
    };
    const result = await draftFolders().insertOne(doc);
    doc._id = result.insertedId;
    return serialize(doc);
}

export async function renameDraftFolder(
    userId: string,
    id: string,
    name: unknown,
) {
    if (!ObjectId.isValid(id)) return null;
    const result = await draftFolders().findOneAndUpdate(
        { _id: new ObjectId(id), userId },
        { $set: { name: sanitizeName(name) } },
        { returnDocument: 'after' },
    );
    return result ? serialize(result) : null;
}

/** Deletes the folder and every draft inside it, plus each of those drafts'
 * scheduled/publication records — mirrors the cleanup a single draft delete
 * does (DELETE /api/drafts/:id), just applied per member draft. */
export async function deleteDraftFolder(
    userId: string,
    accountId: string,
    id: string,
): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await draftFolders().deleteOne({
        _id: new ObjectId(id),
        userId,
    });
    if (result.deletedCount === 0) return false;

    const members = await drafts()
        .find({ userId, folderId: id })
        .project({ _id: 1 })
        .toArray();
    const draftIds = members.map((m) => m._id!.toString());
    await drafts().deleteMany({ userId, folderId: id });
    await Promise.all(
        draftIds.flatMap((draftId) => [
            deleteScheduledPublicationsForDraft(userId, draftId),
            deletePublicationsForDraft(accountId, draftId),
        ]),
    );
    return true;
}

/** Rewrites `order` to match the given id array; ids not owned by the user
 * match nothing, folders missing from the array keep their old order. */
export async function reorderDraftFolders(userId: string, ids: unknown) {
    const validIds = (Array.isArray(ids) ? ids : [])
        .filter((id): id is string => typeof id === 'string')
        .filter((id) => ObjectId.isValid(id));
    if (validIds.length) {
        await draftFolders().bulkWrite(
            validIds.map((id, index) => ({
                updateOne: {
                    filter: { _id: new ObjectId(id), userId },
                    update: { $set: { order: index } },
                },
            })),
        );
    }
    return listDraftFolders(userId);
}
