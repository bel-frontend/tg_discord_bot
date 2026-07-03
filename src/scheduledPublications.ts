import { ObjectId } from 'mongodb';
import {
    scheduledPublications,
    type ScheduledPublicationDoc,
} from './db';
import { getDraft } from './drafts';
import { executePublish } from './publishRequest';
import { resolveImages } from './uploads';
import type { ScheduledPublication } from '../shared/types';

const MIN_SCHEDULE_DELAY_MS = 30 * 1000;

export interface ScheduledPublicationInput {
    draftId?: unknown;
    scheduledAt?: unknown;
}

function serialize(doc: ScheduledPublicationDoc): ScheduledPublication {
    return {
        id: doc._id!.toString(),
        draftId: doc.draftId,
        title: doc.title,
        scheduledAt: doc.scheduledAt.toISOString(),
        status: doc.status,
        error: doc.error,
        results: doc.results,
        publicationId: doc.publicationId,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}

function parseScheduledAt(value: unknown): Date {
    const date = new Date(String(value ?? ''));
    if (Number.isNaN(date.getTime())) {
        throw new Error('Scheduled time is invalid');
    }
    if (date.getTime() < Date.now() + MIN_SCHEDULE_DELAY_MS) {
        throw new Error('Scheduled time must be in the future');
    }
    return date;
}

/** Lists the whole account's shared scheduled-publication queue. */
export async function listScheduledPublications(
    accountId: string,
): Promise<ScheduledPublication[]> {
    const docs = await scheduledPublications()
        .find({ accountId })
        .sort({ scheduledAt: 1, createdAt: 1 })
        .toArray();
    return docs.map(serialize);
}

/**
 * `authorId` is the member scheduling it (drafts/uploads stay private, so firing
 * the schedule later must read the draft as that member); `accountId` is the
 * workspace it publishes under (shared platform credentials + publication history).
 */
export async function createScheduledPublication(
    authorId: string,
    accountId: string,
    input: ScheduledPublicationInput,
): Promise<ScheduledPublication> {
    const draftId = String(input.draftId ?? '');
    if (!ObjectId.isValid(draftId)) throw new Error('Draft is required');

    const draft = await getDraft(authorId, draftId);
    if (!draft) throw new Error('Draft not found');
    if (!draft.targets.length) throw new Error('No channels selected');

    const scheduledAt = parseScheduledAt(input.scheduledAt);
    const now = new Date();
    const doc: ScheduledPublicationDoc = {
        userId: authorId,
        accountId,
        draftId,
        title: draft.title || 'Untitled',
        scheduledAt,
        status: 'scheduled',
        createdAt: now,
        updatedAt: now,
    };
    const result = await scheduledPublications().insertOne(doc);
    doc._id = result.insertedId;
    return serialize(doc);
}

export async function cancelScheduledPublication(
    accountId: string,
    id: string,
): Promise<ScheduledPublication | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await scheduledPublications().findOneAndUpdate(
        {
            _id: new ObjectId(id),
            accountId,
            status: 'scheduled',
        },
        {
            $set: {
                status: 'cancelled',
                updatedAt: new Date(),
            },
        },
        { returnDocument: 'after' },
    );
    return doc ? serialize(doc) : null;
}

/** Draft-linked cleanup — scoped to the draft's actual author, not the whole account. */
export async function deleteScheduledPublicationsForDraft(
    authorId: string,
    draftId: string,
): Promise<number> {
    if (!ObjectId.isValid(draftId)) return 0;
    const result = await scheduledPublications().deleteMany({
        userId: authorId,
        draftId,
    });
    return result.deletedCount;
}

export async function claimDueScheduledPublication(
    now = new Date(),
): Promise<ScheduledPublicationDoc | null> {
    return scheduledPublications().findOneAndUpdate(
        {
            status: 'scheduled',
            scheduledAt: { $lte: now },
        },
        {
            $set: {
                status: 'publishing',
                updatedAt: new Date(),
            },
        },
        {
            sort: { scheduledAt: 1, createdAt: 1 },
            returnDocument: 'after',
        },
    );
}

export async function publishScheduledPublication(
    doc: ScheduledPublicationDoc,
): Promise<void> {
    try {
        const draft = await getDraft(doc.userId, doc.draftId);
        if (!draft) throw new Error('Draft not found');

        const images = await resolveImages(doc.userId, draft.imageIds);
        const { results, publication } = await executePublish(doc.accountId, {
            draftId: draft.id,
            title: draft.title || 'Untitled',
            markdown: draft.markdown,
            imageUrls: draft.imageUrls,
            targets: draft.targets,
            images,
        });

        await scheduledPublications().updateOne(
            { _id: doc._id },
            {
                $set: {
                    title: draft.title || 'Untitled',
                    status: 'published',
                    results,
                    publicationId: publication?.id,
                    updatedAt: new Date(),
                },
                $unset: { error: '' },
            },
        );
    } catch (error: any) {
        await scheduledPublications().updateOne(
            { _id: doc._id },
            {
                $set: {
                    status: 'failed',
                    error: error?.message || 'Scheduled publish failed',
                    updatedAt: new Date(),
                },
            },
        );
    }
}
