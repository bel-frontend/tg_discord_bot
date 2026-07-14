import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';

const draftFolderFindOneMock = mock(async (_filter: any) => null as any);
const draftsInsertOneMock = mock(async (_doc: any) => ({
    insertedId: new ObjectId(),
}));

const draftFoldersCollection = { findOne: draftFolderFindOneMock };
const draftsCollection = { insertOne: draftsInsertOneMock };

const emptyCollection = () => ({
    findOne: mock(async () => null),
    find: mock(() => ({ toArray: async () => [] })),
    insertOne: mock(async () => ({ insertedId: 'id' })),
    findOneAndUpdate: mock(async () => null),
    updateOne: mock(async () => ({ matchedCount: 0, modifiedCount: 0 })),
    deleteOne: mock(async () => ({ deletedCount: 0 })),
    deleteMany: mock(async () => ({ deletedCount: 0 })),
});

mock.module('./db', () => ({
    FULL_ACCESS_PERMISSIONS: {
        canPublish: true,
        canManageResources: true,
        canManagePlatforms: true,
        canManageMembers: true,
        channelAccess: 'all',
    },
    users: emptyCollection,
    accountMembers: emptyCollection,
    emailVerifications: emptyCollection,
    passwordResets: emptyCollection,
    emailChanges: emptyCollection,
    channelResources: emptyCollection,
    uploads: emptyCollection,
    localPublisherAgents: emptyCollection,
    localPublisherJobs: emptyCollection,
    platformConfigs: emptyCollection,
    publications: emptyCollection,
    scheduledPublications: emptyCollection,
    drafts: () => draftsCollection,
    draftFolders: () => draftFoldersCollection,
}));

const { createDraft } = await import('./drafts');

const OWNED_FOLDER_ID = new ObjectId().toString();

beforeEach(() => {
    draftFolderFindOneMock.mockClear();
    draftsInsertOneMock.mockClear();
});

describe('createDraft', () => {
    test('defaults to root (null folderId) when none is given', async () => {
        const draft = await createDraft('user1', { markdown: 'hello' });
        expect(draft.folderId).toBeNull();
        expect(draftFolderFindOneMock).not.toHaveBeenCalled();
    });

    test('persists an owned, valid folderId', async () => {
        draftFolderFindOneMock.mockImplementationOnce(async () => ({
            _id: new ObjectId(OWNED_FOLDER_ID),
            userId: 'user1',
            name: 'Ideas',
            order: 0,
            createdAt: new Date(),
        }));
        const draft = await createDraft('user1', {
            markdown: 'hello',
            folderId: OWNED_FOLDER_ID,
        });
        expect(draft.folderId).toBe(OWNED_FOLDER_ID);
    });

    test('falls back to root for a malformed folderId instead of failing the create', async () => {
        const draft = await createDraft('user1', {
            markdown: 'hello',
            folderId: 'not-an-object-id',
        });
        expect(draft.folderId).toBeNull();
        expect(draftFolderFindOneMock).not.toHaveBeenCalled();
    });

    test("falls back to root for another user's folderId instead of failing the create", async () => {
        draftFolderFindOneMock.mockImplementationOnce(async () => null);
        const draft = await createDraft('user1', {
            markdown: 'hello',
            folderId: OWNED_FOLDER_ID,
        });
        expect(draft.folderId).toBeNull();
    });
});
