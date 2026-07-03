import { describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';

const insertOneMock = mock(async () => ({ insertedId: new ObjectId() }));
const updateOneMock = mock(async () => ({ modifiedCount: 1 }));
const findOneAndUpdateMock = mock(async () => null as any);
const deleteManyMock = mock(async () => ({ deletedCount: 0 }));

const scheduledCollection = {
    insertOne: insertOneMock,
    updateOne: updateOneMock,
    findOneAndUpdate: findOneAndUpdateMock,
    deleteMany: deleteManyMock,
    find: mock(() => ({ sort: () => ({ toArray: async () => [] }) })),
};
const platformConfigsCollection = {
    findOne: mock(async () => null),
    find: mock(() => ({ toArray: async () => [] })),
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
    channelResources: emptyCollection,
    drafts: emptyCollection,
    uploads: emptyCollection,
    publications: emptyCollection,
    scheduledPublications: () => scheduledCollection,
    platformConfigs: () => platformConfigsCollection,
}));

const currentDraft = {
    id: new ObjectId().toString(),
    title: 'Current title',
    markdown: 'current markdown',
    imageUrls: ['https://example.com/current.png'],
    imageIds: ['img1'],
    targets: [{ platform: 'telegram', channelId: 'chan1' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const getDraftMock = mock(async () => currentDraft);
const resolveImagesMock = mock(async () => [
    {
        data: Buffer.from('image'),
        filename: 'img1.png',
        contentType: 'image/png',
    },
]);
const publishToTargetsMock = mock(async () => [
    {
        platform: 'telegram',
        channelId: 'chan1',
        ok: true,
        messageIds: ['1'],
    },
]);
const createPublicationMock = mock(async () => ({
    id: 'pub1',
}));

mock.module('./drafts', () => ({
    createDraft: mock(async () => null),
    deleteDraft: mock(async () => false),
    getDraft: getDraftMock,
    listDrafts: mock(async () => []),
    updateDraft: mock(async () => null),
}));
mock.module('./uploads', () => ({
    getUpload: mock(async () => null),
    resolveImages: resolveImagesMock,
    saveUpload: mock(async () => null),
}));
mock.module('./platforms/registry', () => ({
    publishToTargets: publishToTargetsMock,
    getPlatform: mock(() => undefined),
    listAllChannels: mock(async () => []),
    listPlatforms: mock(() => []),
    listPlatformsMeta: mock(() => []),
}));
mock.module('./publications', () => ({
    createPublication: createPublicationMock,
    deletePublishedTargets: mock(async () => ({ status: 404 })),
    deletePublicationsForDraft: mock(async () => 0),
    getPublication: mock(async () => null),
    listPublications: mock(async () => []),
    updatePublishedTargets: mock(async () => ({ status: 404 })),
}));

const {
    createScheduledPublication,
    deleteScheduledPublicationsForDraft,
    publishScheduledPublication,
} = await import('./scheduledPublications');

describe('createScheduledPublication', () => {
    test('stores a future draft-based scheduled publication', async () => {
        insertOneMock.mockClear();
        const scheduledAt = new Date(Date.now() + 20 * 60 * 1000);

        const result = await createScheduledPublication('user1', 'account1', {
            draftId: currentDraft.id,
            scheduledAt: scheduledAt.toISOString(),
        });

        expect(result.draftId).toBe(currentDraft.id);
        expect(result.title).toBe(currentDraft.title);
        expect(result.status).toBe('scheduled');
        expect(insertOneMock).toHaveBeenCalledTimes(1);
    });
});

describe('deleteScheduledPublicationsForDraft', () => {
    test('deletes scheduled records scoped to the user and draft', async () => {
        deleteManyMock.mockClear();
        deleteManyMock.mockImplementationOnce(async () => ({ deletedCount: 3 }));

        const deleted = await deleteScheduledPublicationsForDraft(
            'user1',
            currentDraft.id,
        );

        expect(deleted).toBe(3);
        expect(deleteManyMock).toHaveBeenCalledWith({
            userId: 'user1',
            draftId: currentDraft.id,
        });
    });
});

describe('publishScheduledPublication', () => {
    test('publishes the current draft content at execution time', async () => {
        publishToTargetsMock.mockClear();
        createPublicationMock.mockClear();
        updateOneMock.mockClear();
        const doc = {
            _id: new ObjectId(),
            userId: 'user1',
            accountId: 'account1',
            draftId: currentDraft.id,
            title: 'Old title',
            scheduledAt: new Date(),
            status: 'publishing' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await publishScheduledPublication(doc);

        expect(publishToTargetsMock).toHaveBeenCalledWith(
            currentDraft.targets,
            {
                markdown: currentDraft.markdown,
                imageUrls: currentDraft.imageUrls,
                images: [
                    {
                        data: Buffer.from('image'),
                        filename: 'img1.png',
                        contentType: 'image/png',
                    },
                ],
            },
            'account1',
        );
        expect(createPublicationMock).toHaveBeenCalledWith('account1', {
            draftId: currentDraft.id,
            title: currentDraft.title,
            markdown: currentDraft.markdown,
            imageUrls: currentDraft.imageUrls,
            results: [
                {
                    platform: 'telegram',
                    channelId: 'chan1',
                    ok: true,
                    messageIds: ['1'],
                },
            ],
        });
        expect(updateOneMock).toHaveBeenCalledWith(
            { _id: doc._id },
            expect.objectContaining({
                $set: expect.objectContaining({
                    status: 'published',
                    title: currentDraft.title,
                    publicationId: 'pub1',
                }),
            }),
        );
    });
});
