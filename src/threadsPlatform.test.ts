import { describe, expect, mock, test } from 'bun:test';
import { ThreadsPlatform } from './platforms/threads';

describe('ThreadsPlatform local publisher adapter', () => {
    test('describes the desktop browser connection flow', () => {
        const platform = new ThreadsPlatform();
        expect(platform.desktopOnly).toBe(true);
        expect(platform.setup.connect).toBe('desktop-browser');
        expect(platform.setup.summary).toContain('inside Composer Desktop');
        expect(platform.setup.steps.join('\n')).toContain('Connect Threads');
        expect(platform.setup.notes.join('\n')).toContain('never uploaded');
    });

    test('keeps the Threads markdown preview', () => {
        const platform = new ThreadsPlatform();
        expect(platform.toPreviewHtml('**Hello**')).toContain('Hello');
    });

    test('keeps Threads visible in the desktop picker between heartbeats', async () => {
        const platform = new ThreadsPlatform();

        expect(
            await platform.listChannels({ accountId: 'workspace-id' }),
        ).toEqual([{ id: 'me', name: 'Local Threads profile' }]);
        expect(await platform.listChannels()).toEqual([]);
    });

    test('publishes text over 500 characters as a reply chain', async () => {
        const jobs: Array<Record<string, unknown>> = [];
        const platform = new ThreadsPlatform({
            hasOnlineLocalPublisher: mock(async () => true),
            enqueueLocalPublisherJob: mock(async (job) => {
                jobs.push(job.payload);
                return `job-${jobs.length}`;
            }),
            waitForLocalPublisherJob: mock(async (_accountId, jobId) => {
                const number = Number(jobId.slice('job-'.length));
                return {
                    messageId: `message-${number}`,
                    link: `https://www.threads.com/@composer/post/${number}`,
                };
            }),
        });

        const [result] = await platform.publish(
            ['me'],
            { markdown: 'word '.repeat(120).trim() },
            { accountId: 'workspace-id' },
        );

        expect(jobs).toHaveLength(2);
        expect(String(jobs[0].text).length).toBeLessThanOrEqual(500);
        expect(jobs[0].replyToLink).toBeUndefined();
        expect(jobs[1].replyToLink).toBe(
            'https://www.threads.com/@composer/post/1',
        );
        expect(result).toEqual({
            platform: 'threads',
            channelId: 'me',
            ok: true,
            messageIds: ['message-1', 'message-2'],
            link: 'https://www.threads.com/@composer/post/1',
        });
    });
});
