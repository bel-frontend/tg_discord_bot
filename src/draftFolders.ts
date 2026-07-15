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
        parentId: doc.parentId ?? null,
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
        .find({ userId, parentId: null })
        .sort({ order: -1 })
        .limit(1)
        .toArray();
    const doc: DraftFolderDoc = {
        userId,
        name: sanitizeName(name),
        order: (last[0]?.order ?? -1) + 1,
        createdAt: new Date(),
        parentId: null,
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

/** Moves a folder under a new parent (or to the root when `parentId` is
 * null), appended after the new parent's current last sibling. Rejects
 * (returns null) self-nesting and nesting a folder inside its own
 * descendant, same as `renameDraftFolder` returning null when not found. */
export async function moveDraftFolder(
    userId: string,
    id: string,
    parentId: unknown,
): Promise<DraftFolder | null> {
    if (!ObjectId.isValid(id)) return null;
    const targetParentId =
        typeof parentId === 'string' && ObjectId.isValid(parentId)
            ? parentId
            : null;
    if (targetParentId === id) return null;

    const owned = await draftFolders()
        .find({ userId })
        .project({ _id: 1, parentId: 1, order: 1 })
        .toArray();
    const byId = new Map(owned.map((f) => [f._id!.toString(), f]));
    const current = byId.get(id);
    if (!current) return null;

    if (targetParentId) {
        if (!byId.has(targetParentId)) return null;
        // Bounded by `visited` so a pre-existing bad parentId chain can't
        // hang this walk even if it weren't otherwise acyclic.
        const visited = new Set<string>();
        let cursor: string | null = targetParentId;
        while (cursor && !visited.has(cursor)) {
            if (cursor === id) return null; // would create a cycle
            visited.add(cursor);
            cursor = byId.get(cursor)?.parentId ?? null;
        }
    }

    // Dropping a folder back onto its current parent is a no-op — keep its
    // existing order instead of bumping it past siblings every time.
    const siblingOrders = owned
        .filter(
            (f) =>
                f._id!.toString() !== id &&
                (f.parentId ?? null) === targetParentId,
        )
        .map((f) => f.order);
    const newOrder =
        (current.parentId ?? null) === targetParentId
            ? current.order
            : Math.max(-1, ...siblingOrders) + 1;

    const result = await draftFolders().findOneAndUpdate(
        { _id: new ObjectId(id), userId },
        { $set: { parentId: targetParentId, order: newOrder } },
        { returnDocument: 'after' },
    );
    return result ? serialize(result) : null;
}

/** Deletes the folder, every descendant folder nested inside it, and every
 * draft inside any of them, plus each of those drafts' scheduled/publication
 * records — mirrors the cleanup a single draft delete does
 * (DELETE /api/drafts/:id), just applied per member draft. */
export async function deleteDraftFolder(
    userId: string,
    accountId: string,
    id: string,
): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;

    const owned = await draftFolders()
        .find({ userId })
        .project({ _id: 1, parentId: 1 })
        .toArray();
    const childrenOf = new Map<string, string[]>();
    for (const f of owned) {
        const parent = f.parentId ?? null;
        if (!parent) continue;
        const list = childrenOf.get(parent) ?? [];
        list.push(f._id!.toString());
        childrenOf.set(parent, list);
    }
    // A Set bounds this against any pre-existing bad parentId cycle: adding
    // an id that's already present is a no-op, so the walk can't loop.
    const idsToDelete = new Set([id]);
    for (const current of idsToDelete) {
        for (const childId of childrenOf.get(current) ?? []) {
            idsToDelete.add(childId);
        }
    }
    const idList = [...idsToDelete];

    const result = await draftFolders().deleteMany({
        _id: { $in: idList.map((x) => new ObjectId(x)) },
        userId,
    });
    if (result.deletedCount === 0) return false;

    const members = await drafts()
        .find({ userId, folderId: { $in: idList } })
        .project({ _id: 1 })
        .toArray();
    const draftIds = members.map((m) => m._id!.toString());
    await drafts().deleteMany({ userId, folderId: { $in: idList } });
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
