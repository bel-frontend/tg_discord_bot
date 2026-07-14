import { ObjectId } from 'mongodb';
import { getUserEmailsByIds, publications, type PublicationDoc } from './db';
import type { PublishResult } from './platforms/types';
import {
    deleteTargets,
    updateTargets,
    type ExistingPublishTarget,
} from './platforms/registry';
import type { Publication, PublicationTarget } from '../shared/types';

export interface PublicationInput {
    draftId: string;
    title: string;
    markdown: string;
    imageUrls: string[];
    results: PublishResult[];
    authorId?: string;
}

function serialize(doc: PublicationDoc, authorEmail?: string): Publication {
    return {
        id: doc._id!.toString(),
        draftId: doc.draftId,
        title: doc.title,
        markdown: doc.markdown,
        imageUrls: doc.imageUrls,
        targets: doc.targets.map(
            (target): PublicationTarget => ({
                platform: target.platform,
                channelId: target.channelId,
                messageIds: target.messageIds,
                ok: target.ok,
                error: target.error,
                updatedAt: target.updatedAt.toISOString(),
                link: target.link,
            }),
        ),
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
        authorEmail,
    };
}

async function serializeWithAuthor(doc: PublicationDoc): Promise<Publication> {
    if (!doc.authorId) return serialize(doc);
    const emailsByUserId = await getUserEmailsByIds([doc.authorId]);
    return serialize(doc, emailsByUserId.get(doc.authorId));
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
        link: result.link,
    }));
}

export async function listPublications(accountId: string, draftId?: string) {
    const filter = draftId ? { userId: accountId, draftId } : { userId: accountId };
    const docs = await publications()
        .find(filter)
        .sort({ updatedAt: -1 })
        .toArray();
    const emailsByAuthorId = await getUserEmailsByIds(
        docs.map((doc) => doc.authorId).filter((id): id is string => Boolean(id)),
    );
    return docs.map((doc) =>
        serialize(doc, doc.authorId ? emailsByAuthorId.get(doc.authorId) : undefined),
    );
}

export async function getPublication(accountId: string, id: string) {
    if (!ObjectId.isValid(id)) return null;
    const doc = await publications().findOne({
        _id: new ObjectId(id),
        userId: accountId,
    });
    return doc ? serializeWithAuthor(doc) : null;
}

export async function createPublication(
    accountId: string,
    input: PublicationInput,
) {
    const now = new Date();
    const doc: PublicationDoc = {
        userId: accountId,
        authorId: input.authorId,
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
    return serializeWithAuthor(doc);
}

export async function updatePublicationResults(
    accountId: string,
    id: string,
    input: Omit<PublicationInput, 'draftId'>,
) {
    if (!ObjectId.isValid(id)) return null;
    const result = await publications().findOneAndUpdate(
        { _id: new ObjectId(id), userId: accountId },
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
    return result ? serializeWithAuthor(result) : null;
}

export async function deletePublicationRecord(accountId: string, id: string) {
    if (!ObjectId.isValid(id)) return false;
    const result = await publications().deleteOne({
        _id: new ObjectId(id),
        userId: accountId,
    });
    return result.deletedCount > 0;
}

export async function deletePublicationsForDraft(
    accountId: string,
    draftId: string,
): Promise<number> {
    if (!ObjectId.isValid(draftId)) return 0;
    const result = await publications().deleteMany({ userId: accountId, draftId });
    return result.deletedCount;
}

function buildRefs(publication: Publication): ExistingPublishTarget[] {
    return publication.targets
        .filter((target) => target.messageIds.length)
        .map((target) => ({
            platform: target.platform,
            channelId: target.channelId,
            messageIds: target.messageIds,
        }));
}

/**
 * `updatePublicationResults` replaces the whole stored `targets` array with
 * whatever this action's results contain. `buildRefs` only attempts targets
 * with a stored message id, so a target that was never sendable is silently
 * excluded from `results` — without this merge, replacing the array would
 * permanently erase it even though this action never touched it.
 */
function mergeUntouchedTargets(
    existing: PublicationTarget[],
    results: PublishResult[],
): PublishResult[] {
    const touched = new Set(results.map((r) => `${r.platform}:${r.channelId}`));
    const untouched: PublishResult[] = existing
        .filter((target) => !touched.has(`${target.platform}:${target.channelId}`))
        .map((target) => ({
            platform: target.platform,
            channelId: target.channelId,
            ok: target.ok,
            messageIds: target.messageIds,
            error: target.error,
            link: target.link,
        }));
    return [...results, ...untouched];
}

/** Re-send the given publication's content to its already-published messages. */
export async function updatePublishedTargets(
    accountId: string,
    publicationId: string,
    input: { title?: unknown; markdown?: unknown; imageUrls?: unknown },
): Promise<
    | { error: string; status: number }
    | { results: PublishResult[]; publication: Publication }
> {
    const publication = await getPublication(accountId, publicationId);
    if (!publication) return { error: 'Not found', status: 404 };

    const refs = buildRefs(publication);
    if (!refs.length) {
        return {
            error: 'No stored message ids for this publication',
            status: 400,
        };
    }

    const markdown = String(input.markdown ?? publication.markdown ?? '');
    const imageUrls = Array.isArray(input.imageUrls)
        ? input.imageUrls.map(String)
        : [];
    if (!markdown.trim() && !imageUrls.length) {
        return { error: 'Content is empty', status: 400 };
    }

    const results = await updateTargets(refs, { markdown, imageUrls }, accountId);
    const updated = await updatePublicationResults(accountId, publicationId, {
        title: String(input.title ?? publication.title ?? 'Untitled'),
        markdown,
        imageUrls,
        results: mergeUntouchedTargets(publication.targets, results),
    });
    return { results, publication: updated! };
}

/** Delete the given publication's already-published messages and its record. */
export async function deletePublishedTargets(
    accountId: string,
    publicationId: string,
): Promise<
    | { error: string; status: number }
    | { results: PublishResult[]; deleted: boolean }
> {
    const publication = await getPublication(accountId, publicationId);
    if (!publication) return { error: 'Not found', status: 404 };

    const refs = buildRefs(publication);
    if (!refs.length) {
        return {
            error: 'No stored message ids for this publication',
            status: 400,
        };
    }

    const results = await deleteTargets(refs, accountId);
    const ok = results.every((result) => result.ok);
    if (ok) await deletePublicationRecord(accountId, publicationId);
    return { results, deleted: ok };
}
