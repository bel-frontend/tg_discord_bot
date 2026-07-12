import { describe, expect, mock, test } from 'bun:test';

const publishToTargetsMock = mock(async () => [
    { platform: 'telegram', channelId: 'chan1', ok: true, messageIds: ['1'] },
]);
const createPublicationMock = mock(async (_userId: string, input: any) => ({
    id: 'pub1',
    ...input,
    targets: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
}));
const resolveImagesMock = mock(async (_userId: string, ids: string[]) =>
    ids.map((id) => ({
        data: Buffer.from('fake-bytes'),
        filename: `${id}.png`,
        contentType: 'image/png',
    })),
);

// mock.module() replaces this specifier process-wide for the whole `bun test` run, so
// this factory must cover every export any consumer needs (publications.test.ts's
// subject also imports from here) — not just what this file's own tests exercise.
mock.module('./platforms/registry', () => ({
    publishToTargets: publishToTargetsMock,
    updateTargets: mock(async () => []),
    deleteTargets: mock(async () => []),
    getPlatform: mock(() => undefined),
    listPlatforms: mock(() => []),
}));
// publications.test.ts imports the REAL './publications' as its own subject under test —
// this mock only stays isolated to this file because Bun runs *.test.ts alphabetically
// ("publications.test.ts" before "publishRequest.test.ts"), so the real module is already
// bound there before this mock registers. Keep this file's name sorting after
// publications.test.ts, or this mock will shadow that file's subject.
mock.module('./publications', () => ({
    createPublication: createPublicationMock,
}));
mock.module('./uploads', () => ({
    resolveImages: resolveImagesMock,
}));

const { parsePublishRequest, executePublish } = await import(
    './publishRequest'
);

function jsonRequest(body: unknown): Request {
    return new Request('http://x/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('parsePublishRequest (JSON body)', () => {
    test('parses fields and resolves imageIds to images', async () => {
        const parsed = await parsePublishRequest(
            jsonRequest({
                markdown: 'hello',
                draftId: 'd1',
                title: 'My post',
                targets: [{ platform: 'telegram', channelId: 'chan1' }],
                imageUrls: ['https://example.com/a.png'],
                imageIds: ['img1', 'img2'],
            }),
            'user1',
        );

        expect(parsed.markdown).toBe('hello');
        expect(parsed.draftId).toBe('d1');
        expect(parsed.title).toBe('My post');
        expect(parsed.targets).toEqual([
            { platform: 'telegram', channelId: 'chan1' },
        ]);
        expect(parsed.imageUrls).toEqual(['https://example.com/a.png']);
        expect(parsed.images).toHaveLength(2);
        expect(resolveImagesMock).toHaveBeenCalledWith('user1', [
            'img1',
            'img2',
        ]);
    });

    test('defaults missing fields to empty values', async () => {
        const parsed = await parsePublishRequest(jsonRequest({}), 'user1');
        expect(parsed.markdown).toBe('');
        expect(parsed.draftId).toBe('');
        expect(parsed.title).toBe('');
        expect(parsed.targets).toEqual([]);
        expect(parsed.imageUrls).toEqual([]);
        expect(parsed.images).toEqual([]);
    });
});

describe('parsePublishRequest (multipart body)', () => {
    function multipartRequest(fields: Record<string, string>, files: File[] = []) {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        for (const file of files) form.append('images', file);
        return new Request('http://x/api/publish', {
            method: 'POST',
            body: form,
        });
    }

    test('parses fields, targets and image files', async () => {
        const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', {
            type: 'image/png',
        });
        const parsed = await parsePublishRequest(
            multipartRequest(
                {
                    markdown: 'hi',
                    draftId: 'd2',
                    title: 'Title',
                    targets: JSON.stringify([
                        { platform: 'discord', channelId: 'chan2' },
                    ]),
                    imageUrls: JSON.stringify(['https://x/y.png']),
                },
                [file],
            ),
            'user1',
        );

        expect(parsed.markdown).toBe('hi');
        expect(parsed.targets).toEqual([
            { platform: 'discord', channelId: 'chan2' },
        ]);
        expect(parsed.imageUrls).toEqual(['https://x/y.png']);
        expect(parsed.images).toHaveLength(1);
        expect(parsed.images[0].filename).toBe('photo.png');
        expect(parsed.images[0].contentType).toBe('image/png');
    });

    test('rejects a non-image file with the exact user-facing message', async () => {
        const file = new File([new Uint8Array([1])], 'doc.pdf', {
            type: 'application/pdf',
        });
        await expect(
            parsePublishRequest(
                multipartRequest(
                    { markdown: 'x', targets: '[]', imageUrls: '[]' },
                    [file],
                ),
                'user1',
            ),
        ).rejects.toThrow('"doc.pdf" is not an image');
    });

    test('rejects an oversized image with the exact user-facing message', async () => {
        const bigBytes = new Uint8Array(10 * 1024 * 1024 + 1);
        const file = new File([bigBytes], 'big.png', { type: 'image/png' });
        await expect(
            parsePublishRequest(
                multipartRequest(
                    { markdown: 'x', targets: '[]', imageUrls: '[]' },
                    [file],
                ),
                'user1',
            ),
        ).rejects.toThrow('"big.png" is larger than 10 MB');
    });

    test('rejects malformed JSON in the targets field', async () => {
        await expect(
            parsePublishRequest(
                multipartRequest({
                    markdown: 'x',
                    targets: 'not-json',
                    imageUrls: '[]',
                }),
                'user1',
            ),
        ).rejects.toThrow('Invalid publish payload');
    });
});

describe('executePublish', () => {
    test('rejects when there are no targets', async () => {
        await expect(
            executePublish('user1', {
                markdown: 'hi',
                draftId: '',
                title: '',
                targets: [],
                imageUrls: [],
                images: [],
                silent: false,
            }),
        ).rejects.toThrow('No channels selected');
    });

    test('rejects when there is no content', async () => {
        await expect(
            executePublish('user1', {
                markdown: '   ',
                draftId: '',
                title: '',
                targets: [{ platform: 'telegram', channelId: 'chan1' }],
                imageUrls: [],
                images: [],
                silent: false,
            }),
        ).rejects.toThrow('Content is empty');
    });

    test('publishes and creates a publication record when draftId is set', async () => {
        publishToTargetsMock.mockClear();
        createPublicationMock.mockClear();

        const outcome = await executePublish('user1', {
            markdown: 'hi',
            draftId: 'd1',
            title: '',
            targets: [{ platform: 'telegram', channelId: 'chan1' }],
            imageUrls: [],
            images: [],
            silent: false,
        });

        expect(publishToTargetsMock).toHaveBeenCalledWith(
            [{ platform: 'telegram', channelId: 'chan1' }],
            { markdown: 'hi', imageUrls: [], images: [], silent: false },
            'user1',
        );
        expect(createPublicationMock).toHaveBeenCalledTimes(1);
        expect(outcome.publication).not.toBeNull();
        expect(outcome.publication?.title).toBe('Untitled');
        expect(outcome.results).toHaveLength(1);
    });

    test('publishes without creating a publication record when draftId is empty', async () => {
        publishToTargetsMock.mockClear();
        createPublicationMock.mockClear();

        const outcome = await executePublish('user1', {
            markdown: 'hi',
            draftId: '',
            title: '',
            targets: [{ platform: 'telegram', channelId: 'chan1' }],
            imageUrls: [],
            images: [],
            silent: false,
        });

        expect(publishToTargetsMock).toHaveBeenCalledWith(
            [{ platform: 'telegram', channelId: 'chan1' }],
            { markdown: 'hi', imageUrls: [], images: [], silent: false },
            'user1',
        );
        expect(createPublicationMock).not.toHaveBeenCalled();
        expect(outcome.publication).toBeNull();
    });
});
