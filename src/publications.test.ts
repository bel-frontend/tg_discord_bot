import { describe, expect, mock, test } from 'bun:test';
import { ObjectId } from 'mongodb';

const findOneMock = mock(async (_filter: any) => null as any);
const findOneAndUpdateMock = mock(async (_filter: any, _update: any) => null as any);
const deleteOneMock = mock(async (_filter: any) => ({ deletedCount: 0 }));

const fakeCollection = {
    findOne: findOneMock,
    findOneAndUpdate: findOneAndUpdateMock,
    deleteOne: deleteOneMock,
    find: mock(() => ({ sort: () => ({ toArray: async () => [] }) })),
};

mock.module('./db', () => ({
    publications: () => fakeCollection,
}));

const updateTargetsMock = mock(async (_refs: unknown[], _content: unknown) => [
    { platform: 'telegram', channelId: 'chan1', ok: true, messageIds: ['1'] },
]);
const deleteTargetsMock = mock(async (_refs: unknown[]) => [
    { platform: 'telegram', channelId: 'chan1', ok: true, messageIds: ['1'] },
]);

// mock.module() replaces this specifier process-wide for the whole `bun test` run, so
// this factory must cover every export any consumer needs (publishRequest.test.ts's
// subject also imports from here) — not just what this file's own tests exercise.
mock.module('./platforms/registry', () => ({
    updateTargets: updateTargetsMock,
    deleteTargets: deleteTargetsMock,
    publishToTargets: mock(async () => []),
}));

const { updatePublishedTargets, deletePublishedTargets } = await import(
    './publications'
);

function makeDoc(overrides: Record<string, any> = {}) {
    return {
        _id: new ObjectId(),
        userId: 'user1',
        draftId: 'd1',
        title: 'My post',
        markdown: 'hello',
        imageUrls: [],
        targets: [
            {
                platform: 'telegram',
                channelId: 'chan1',
                messageIds: ['1'],
                ok: true,
                error: undefined,
                updatedAt: new Date(),
            },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    };
}

const VALID_ID = new ObjectId().toString();

describe('updatePublishedTargets', () => {
    test('returns a 404-shaped result when the publication does not exist', async () => {
        findOneMock.mockImplementationOnce(async () => null);
        const outcome = await updatePublishedTargets('user1', VALID_ID, {
            markdown: 'x',
        });
        expect(outcome).toEqual({ error: 'Not found', status: 404 });
    });

    test('returns a 400-shaped result when no targets have stored message ids', async () => {
        const doc = makeDoc({ targets: [] });
        findOneMock.mockImplementationOnce(async () => doc);
        const outcome = await updatePublishedTargets('user1', VALID_ID, {
            markdown: 'x',
        });
        expect(outcome).toEqual({
            error: 'No stored message ids for this publication',
            status: 400,
        });
    });

    test('filters out targets that are not ok or have no message ids', async () => {
        const doc = makeDoc({
            targets: [
                {
                    platform: 'telegram',
                    channelId: 'ok-chan',
                    messageIds: ['1'],
                    ok: true,
                    updatedAt: new Date(),
                },
                {
                    platform: 'telegram',
                    channelId: 'failed-chan',
                    messageIds: [],
                    ok: false,
                    updatedAt: new Date(),
                },
            ],
        });
        findOneMock.mockImplementationOnce(async () => doc);
        findOneAndUpdateMock.mockImplementationOnce(async (_f, update) => ({
            ...doc,
            ...update.$set,
        }));
        updateTargetsMock.mockClear();

        await updatePublishedTargets('user1', VALID_ID, { markdown: 'new content' });

        expect(updateTargetsMock).toHaveBeenCalledTimes(1);
        const [refs] = updateTargetsMock.mock.calls[0];
        expect(refs).toEqual([
            { platform: 'telegram', channelId: 'ok-chan', messageIds: ['1'] },
        ]);
    });

    test('returns a 400-shaped result when the new content is empty', async () => {
        const doc = makeDoc();
        findOneMock.mockImplementationOnce(async () => doc);
        const outcome = await updatePublishedTargets('user1', VALID_ID, {
            markdown: '',
            imageUrls: [],
        });
        expect(outcome).toEqual({ error: 'Content is empty', status: 400 });
    });

    test('updates targets and returns the refreshed publication on success', async () => {
        const doc = makeDoc();
        findOneMock.mockImplementationOnce(async () => doc);
        findOneAndUpdateMock.mockImplementationOnce(async (_f, update) => ({
            ...doc,
            ...update.$set,
        }));

        const outcome = await updatePublishedTargets('user1', VALID_ID, {
            title: 'New title',
            markdown: 'new content',
            imageUrls: [],
        });

        expect('error' in outcome).toBe(false);
        if (!('error' in outcome)) {
            expect(outcome.results).toHaveLength(1);
            expect(outcome.publication.title).toBe('New title');
            expect(outcome.publication.markdown).toBe('new content');
        }
    });
});

describe('deletePublishedTargets', () => {
    test('returns a 404-shaped result when the publication does not exist', async () => {
        findOneMock.mockImplementationOnce(async () => null);
        const outcome = await deletePublishedTargets('user1', VALID_ID);
        expect(outcome).toEqual({ error: 'Not found', status: 404 });
    });

    test('returns a 400-shaped result when no targets have stored message ids', async () => {
        const doc = makeDoc({ targets: [] });
        findOneMock.mockImplementationOnce(async () => doc);
        const outcome = await deletePublishedTargets('user1', VALID_ID);
        expect(outcome).toEqual({
            error: 'No stored message ids for this publication',
            status: 400,
        });
    });

    test('deletes the DB record when every platform delete succeeds', async () => {
        const doc = makeDoc();
        findOneMock.mockImplementationOnce(async () => doc);
        deleteTargetsMock.mockImplementationOnce(async () => [
            { platform: 'telegram', channelId: 'chan1', ok: true, messageIds: ['1'] },
        ]);
        deleteOneMock.mockClear();
        deleteOneMock.mockImplementationOnce(async () => ({ deletedCount: 1 }));

        const outcome = await deletePublishedTargets('user1', VALID_ID);

        expect(outcome).toEqual({
            results: [
                { platform: 'telegram', channelId: 'chan1', ok: true, messageIds: ['1'] },
            ],
            deleted: true,
        });
        expect(deleteOneMock).toHaveBeenCalledTimes(1);
    });

    test('does not delete the DB record when a platform delete fails', async () => {
        const doc = makeDoc();
        findOneMock.mockImplementationOnce(async () => doc);
        deleteTargetsMock.mockImplementationOnce(async () => [
            {
                platform: 'telegram',
                channelId: 'chan1',
                ok: false,
                messageIds: ['1'],
                error: 'boom',
            },
        ]);
        deleteOneMock.mockClear();

        const outcome = await deletePublishedTargets('user1', VALID_ID);

        expect('error' in outcome).toBe(false);
        if (!('error' in outcome)) {
            expect(outcome.deleted).toBe(false);
        }
        expect(deleteOneMock).not.toHaveBeenCalled();
    });
});
