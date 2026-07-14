import { ObjectId } from 'mongodb';
import { draftFolders, drafts, type DraftDoc } from './db';
import type { Draft, Target } from '../shared/types';

export interface DraftInput {
    title?: string;
    markdown?: string;
    imageUrls?: string[];
    imageIds?: string[];
    targets?: Target[];
    silent?: unknown;
    /** Folder to create the draft in, resolved leniently — see `resolveFolderIdOnCreate`. */
    folderId?: unknown;
}

function serialize(doc: DraftDoc): Draft {
    return {
        id: doc._id!.toString(),
        title: doc.title,
        markdown: doc.markdown,
        imageUrls: doc.imageUrls,
        imageIds: doc.imageIds ?? [],
        targets: doc.targets,
        silent: doc.silent ?? false,
        folderId: doc.folderId ?? null,
        pinned: doc.pinned ?? false,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

function sanitize(input: DraftInput): {
    title: string;
    markdown: string;
    imageUrls: string[];
    imageIds: string[];
    targets: Target[];
    silent: boolean;
} {
    return {
        title: (input.title ?? 'Untitled').toString().slice(0, 200),
        markdown: (input.markdown ?? '').toString(),
        imageUrls: Array.isArray(input.imageUrls)
            ? input.imageUrls.map(String)
            : [],
        imageIds: Array.isArray(input.imageIds)
            ? input.imageIds.map(String)
            : [],
        targets: Array.isArray(input.targets)
            ? input.targets
                  .filter((t) => t && t.platform && t.channelId)
                  .map((t) => ({
                      platform: String(t.platform),
                      channelId: String(t.channelId),
                  }))
            : [],
        silent: Boolean(input.silent),
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

/** Unlike organizeDraft's strict validation (which aborts a PATCH on a bad
 * folderId), a bad/deleted/foreign folderId here must not fail the create —
 * it just falls back to root, so a first autosave never appears to lose the
 * user's typed content. */
async function resolveFolderIdOnCreate(
    userId: string,
    raw: unknown,
): Promise<string | null> {
    if (raw == null) return null;
    const folderId = String(raw);
    if (!ObjectId.isValid(folderId)) return null;
    const folder = await draftFolders().findOne({
        _id: new ObjectId(folderId),
        userId,
    });
    return folder ? folderId : null;
}

export async function createDraft(userId: string, input: DraftInput) {
    const now = new Date();
    const folderId = await resolveFolderIdOnCreate(userId, input.folderId);
    const doc: DraftDoc = {
        userId,
        ...sanitize(input),
        folderId,
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

export interface DraftOrganizeInput {
    title?: unknown;
    folderId?: unknown;
    pinned?: unknown;
}

/** Partial update for rename/move/pin from the drafts tree. Deliberately does
 * NOT bump updatedAt — the list sorts by it, and organizing a draft must not
 * reorder the list (unlike updateDraft, which also full-replaces content). */
export async function organizeDraft(
    userId: string,
    id: string,
    input: DraftOrganizeInput,
) {
    if (!ObjectId.isValid(id)) return null;

    const $set: Partial<DraftDoc> = {};
    if ('title' in input) {
        const title = String(input.title ?? '').trim().slice(0, 200);
        if (title) $set.title = title;
    }
    if ('folderId' in input) {
        if (input.folderId === null) {
            $set.folderId = null;
        } else {
            const folderId = String(input.folderId);
            if (!ObjectId.isValid(folderId)) return null;
            const folder = await draftFolders().findOne({
                _id: new ObjectId(folderId),
                userId,
            });
            if (!folder) return null;
            $set.folderId = folderId;
        }
    }
    if ('pinned' in input) $set.pinned = Boolean(input.pinned);
    if (!Object.keys($set).length) return getDraft(userId, id);

    const result = await drafts().findOneAndUpdate(
        { _id: new ObjectId(id), userId },
        { $set },
        { returnDocument: 'after' },
    );
    return result ? serialize(result) : null;
}

export async function deleteDraft(userId: string, id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const result = await drafts().deleteOne({ _id: new ObjectId(id), userId });
    return result.deletedCount > 0;
}
