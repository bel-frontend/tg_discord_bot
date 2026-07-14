import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';

const draftFolderDeleteOneMock = mock(async (_filter: any) => ({
    deletedCount: 0,
}));
const draftsFindMock = mock((_filter: any) => ({
    project: () => ({ toArray: async () => [] as { _id: ObjectId }[] }),
}));
const draftsDeleteManyMock = mock(async (_filter: any) => ({
    deletedCount: 0,
}));

const draftFoldersCollection = { deleteOne: draftFolderDeleteOneMock };
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

const { deleteDraftFolder } = await import('./draftFolders');

const VALID_FOLDER_ID = new ObjectId().toString();

beforeEach(() => {
    draftFolderDeleteOneMock.mockClear();
    draftsFindMock.mockClear();
    draftsDeleteManyMock.mockClear();
    deletePublicationsForDraftMock.mockClear();
    deleteScheduledPublicationsForDraftMock.mockClear();
});

describe('deleteDraftFolder', () => {
    test('returns false for an invalid id without touching any collection', async () => {
        const ok = await deleteDraftFolder('user1', 'account1', 'not-an-id');
        expect(ok).toBe(false);
        expect(draftFolderDeleteOneMock).not.toHaveBeenCalled();
    });

    test('returns false when the folder is not found (foreign or missing), leaving drafts untouched', async () => {
        draftFolderDeleteOneMock.mockImplementationOnce(async () => ({
            deletedCount: 0,
        }));
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
        draftFolderDeleteOneMock.mockImplementationOnce(async () => ({
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
            folderId: VALID_FOLDER_ID,
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
        draftFolderDeleteOneMock.mockImplementationOnce(async () => ({
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
            folderId: VALID_FOLDER_ID,
        });
        expect(deleteScheduledPublicationsForDraftMock).not.toHaveBeenCalled();
        expect(deletePublicationsForDraftMock).not.toHaveBeenCalled();
    });
});
