import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';

function makeCursor(rows: any[]) {
    const cursor: any = {
        project: () => cursor,
        sort: () => cursor,
        limit: () => cursor,
        toArray: async () => rows,
    };
    return cursor;
}

const draftFolderFindMock = mock((_filter: any) => makeCursor([]));
const draftFolderDeleteManyMock = mock(async (_filter: any) => ({
    deletedCount: 0,
}));
const draftFolderFindOneAndUpdateMock = mock(async (_filter: any, _update: any) => null as any);
const draftsFindMock = mock((_filter: any) => ({
    project: () => ({ toArray: async () => [] as { _id: ObjectId }[] }),
}));
const draftsDeleteManyMock = mock(async (_filter: any) => ({
    deletedCount: 0,
}));

const draftFoldersCollection = {
    find: draftFolderFindMock,
    deleteMany: draftFolderDeleteManyMock,
    findOneAndUpdate: draftFolderFindOneAndUpdateMock,
};
const draftsCollection = {
    find: draftsFindMock,
    deleteMany: draftsDeleteManyMock,
};

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

// Mocked at the function level (not via ./db) since ./publications and
// ./scheduledPublications may already be cached with a different test
// file's ./db mock bound into their closures by the time this file runs.
const deletePublicationsForDraftMock = mock(
    async (_accountId: string, _draftId: string) => 0,
);
const deleteScheduledPublicationsForDraftMock = mock(
    async (_userId: string, _draftId: string) => 0,
);
mock.module('./publications', () => ({
    deletePublicationsForDraft: deletePublicationsForDraftMock,
}));
mock.module('./scheduledPublications', () => ({
    deleteScheduledPublicationsForDraft: deleteScheduledPublicationsForDraftMock,
}));

const { deleteDraftFolder, moveDraftFolder } = await import('./draftFolders');

const VALID_FOLDER_ID = new ObjectId().toString();

beforeEach(() => {
    draftFolderFindMock.mockReset();
    draftFolderFindMock.mockImplementation(() => makeCursor([]));
    draftFolderDeleteManyMock.mockReset();
    draftFolderDeleteManyMock.mockImplementation(async () => ({
        deletedCount: 0,
    }));
    draftFolderFindOneAndUpdateMock.mockReset();
    draftFolderFindOneAndUpdateMock.mockImplementation(async () => null);
    draftsFindMock.mockClear();
    draftsDeleteManyMock.mockClear();
    deletePublicationsForDraftMock.mockClear();
    deleteScheduledPublicationsForDraftMock.mockClear();
});

describe('deleteDraftFolder', () => {
    test('returns false for an invalid id without touching any collection', async () => {
        const ok = await deleteDraftFolder('user1', 'account1', 'not-an-id');
        expect(ok).toBe(false);
        expect(draftFolderFindMock).not.toHaveBeenCalled();
    });

    test('returns false when the folder is not found (foreign or missing), leaving drafts untouched', async () => {
        draftFolderFindMock.mockImplementationOnce(() => makeCursor([]));
        const ok = await deleteDraftFolder(
            'user1',
            'account1',
            VALID_FOLDER_ID,
        );
        expect(ok).toBe(false);
        expect(draftsFindMock).not.toHaveBeenCalled();
        expect(draftsDeleteManyMock).not.toHaveBeenCalled();
    });

    test('cascades: deletes the folder, its drafts, and each draft\'s scheduled/publication records', async () => {
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([{ _id: new ObjectId(VALID_FOLDER_ID), parentId: null }]),
        );
        draftFolderDeleteManyMock.mockImplementationOnce(async () => ({
            deletedCount: 1,
        }));
        const memberIds = [new ObjectId(), new ObjectId()];
        draftsFindMock.mockImplementationOnce(() => ({
            project: () => ({
                toArray: async () => memberIds.map((_id) => ({ _id })),
            }),
        }));

        const ok = await deleteDraftFolder(
            'user1',
            'account1',
            VALID_FOLDER_ID,
        );

        expect(ok).toBe(true);
        expect(draftsDeleteManyMock).toHaveBeenCalledWith({
            userId: 'user1',
            folderId: { $in: [VALID_FOLDER_ID] },
        });
        expect(deleteScheduledPublicationsForDraftMock).toHaveBeenCalledTimes(
            2,
        );
        expect(deletePublicationsForDraftMock).toHaveBeenCalledTimes(2);
        for (const id of memberIds) {
            expect(
                deleteScheduledPublicationsForDraftMock,
            ).toHaveBeenCalledWith('user1', id.toString());
            expect(deletePublicationsForDraftMock).toHaveBeenCalledWith(
                'account1',
                id.toString(),
            );
        }
    });

    test('deletes cleanly when the folder has no member drafts', async () => {
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([{ _id: new ObjectId(VALID_FOLDER_ID), parentId: null }]),
        );
        draftFolderDeleteManyMock.mockImplementationOnce(async () => ({
            deletedCount: 1,
        }));
        draftsFindMock.mockImplementationOnce(() => ({
            project: () => ({ toArray: async () => [] }),
        }));

        const ok = await deleteDraftFolder(
            'user1',
            'account1',
            VALID_FOLDER_ID,
        );

        expect(ok).toBe(true);
        expect(draftsDeleteManyMock).toHaveBeenCalledWith({
            userId: 'user1',
            folderId: { $in: [VALID_FOLDER_ID] },
        });
        expect(deleteScheduledPublicationsForDraftMock).not.toHaveBeenCalled();
        expect(deletePublicationsForDraftMock).not.toHaveBeenCalled();
    });

    test('cascades through nested subfolders, deleting their drafts too', async () => {
        const childId = new ObjectId();
        const grandchildId = new ObjectId();
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([
                { _id: new ObjectId(VALID_FOLDER_ID), parentId: null },
                { _id: childId, parentId: VALID_FOLDER_ID },
                { _id: grandchildId, parentId: childId.toString() },
            ]),
        );
        draftFolderDeleteManyMock.mockImplementationOnce(async () => ({
            deletedCount: 3,
        }));
        draftsFindMock.mockImplementationOnce(() => ({
            project: () => ({ toArray: async () => [] }),
        }));

        const ok = await deleteDraftFolder(
            'user1',
            'account1',
            VALID_FOLDER_ID,
        );

        expect(ok).toBe(true);
        const expectedIds = [
            VALID_FOLDER_ID,
            childId.toString(),
            grandchildId.toString(),
        ];
        expect(draftFolderDeleteManyMock).toHaveBeenCalledWith({
            _id: { $in: expectedIds.map((id) => new ObjectId(id)) },
            userId: 'user1',
        });
        expect(draftsDeleteManyMock).toHaveBeenCalledWith({
            userId: 'user1',
            folderId: { $in: expectedIds },
        });
    });
});

describe('moveDraftFolder', () => {
    test('returns null for an invalid id', async () => {
        const result = await moveDraftFolder('user1', 'not-an-id', null);
        expect(result).toBeNull();
        expect(draftFolderFindMock).not.toHaveBeenCalled();
    });

    test('returns null when nesting a folder into itself', async () => {
        const result = await moveDraftFolder(
            'user1',
            VALID_FOLDER_ID,
            VALID_FOLDER_ID,
        );
        expect(result).toBeNull();
        expect(draftFolderFindMock).not.toHaveBeenCalled();
    });

    test('returns null when the target parent does not belong to the user', async () => {
        const otherParentId = new ObjectId().toString();
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([{ _id: new ObjectId(VALID_FOLDER_ID), parentId: null }]),
        );

        const result = await moveDraftFolder(
            'user1',
            VALID_FOLDER_ID,
            otherParentId,
        );

        expect(result).toBeNull();
        expect(draftFolderFindOneAndUpdateMock).not.toHaveBeenCalled();
    });

    test('returns null when the move would create a cycle', async () => {
        // folderA is the parent of folderB; moving folderA under folderB
        // would nest a folder inside its own descendant.
        const folderA = new ObjectId(VALID_FOLDER_ID);
        const folderB = new ObjectId();
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([
                { _id: folderA, parentId: null },
                { _id: folderB, parentId: folderA.toString() },
            ]),
        );

        const result = await moveDraftFolder(
            'user1',
            folderA.toString(),
            folderB.toString(),
        );

        expect(result).toBeNull();
        expect(draftFolderFindOneAndUpdateMock).not.toHaveBeenCalled();
    });

    test('nests a folder under a new parent, appending after the last sibling', async () => {
        const parent = new ObjectId();
        const sibling = new ObjectId();
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([
                { _id: new ObjectId(VALID_FOLDER_ID), parentId: null, order: 0 },
                { _id: parent, parentId: null, order: 1 },
                { _id: sibling, parentId: parent.toString(), order: 2 },
            ]),
        );
        draftFolderFindOneAndUpdateMock.mockImplementationOnce(async () => ({
            _id: new ObjectId(VALID_FOLDER_ID),
            userId: 'user1',
            name: 'Folder',
            order: 3,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            parentId: parent.toString(),
        }));

        const result = await moveDraftFolder(
            'user1',
            VALID_FOLDER_ID,
            parent.toString(),
        );

        expect(result).toEqual({
            id: VALID_FOLDER_ID,
            name: 'Folder',
            order: 3,
            createdAt: '2026-07-01T00:00:00.000Z',
            parentId: parent.toString(),
        });
        expect(draftFolderFindOneAndUpdateMock).toHaveBeenCalledWith(
            { _id: new ObjectId(VALID_FOLDER_ID), userId: 'user1' },
            { $set: { parentId: parent.toString(), order: 3 } },
            { returnDocument: 'after' },
        );
    });

    test('moves a folder back to the root when parentId is null', async () => {
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([
                {
                    _id: new ObjectId(VALID_FOLDER_ID),
                    parentId: new ObjectId().toString(),
                    order: 5,
                },
            ]),
        );
        draftFolderFindOneAndUpdateMock.mockImplementationOnce(async () => ({
            _id: new ObjectId(VALID_FOLDER_ID),
            userId: 'user1',
            name: 'Folder',
            order: 0,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            parentId: null,
        }));

        const result = await moveDraftFolder('user1', VALID_FOLDER_ID, null);

        expect(result?.parentId).toBeNull();
        expect(draftFolderFindOneAndUpdateMock).toHaveBeenCalledWith(
            { _id: new ObjectId(VALID_FOLDER_ID), userId: 'user1' },
            { $set: { parentId: null, order: 0 } },
            { returnDocument: 'after' },
        );
    });

    test('keeps the current order when dropped back onto its existing parent (no-op)', async () => {
        const parent = new ObjectId();
        draftFolderFindMock.mockImplementationOnce(() =>
            makeCursor([
                {
                    _id: new ObjectId(VALID_FOLDER_ID),
                    parentId: parent.toString(),
                    order: 7,
                },
                { _id: parent, parentId: null, order: 0 },
            ]),
        );
        draftFolderFindOneAndUpdateMock.mockImplementationOnce(async () => ({
            _id: new ObjectId(VALID_FOLDER_ID),
            userId: 'user1',
            name: 'Folder',
            order: 7,
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
            parentId: parent.toString(),
        }));

        const result = await moveDraftFolder(
            'user1',
            VALID_FOLDER_ID,
            parent.toString(),
        );

        expect(result?.order).toBe(7);
        expect(draftFolderFindOneAndUpdateMock).toHaveBeenCalledWith(
            { _id: new ObjectId(VALID_FOLDER_ID), userId: 'user1' },
            { $set: { parentId: parent.toString(), order: 7 } },
            { returnDocument: 'after' },
        );
    });

    test('returns null when the folder is not found/owned', async () => {
        draftFolderFindMock.mockImplementationOnce(() => makeCursor([]));
        draftFolderFindOneAndUpdateMock.mockImplementationOnce(
            async () => null,
        );

        const result = await moveDraftFolder('user1', VALID_FOLDER_ID, null);

        expect(result).toBeNull();
    });
});
