import type {
    Channel,
    Platform,
    PlatformContext,
    PublishContent,
    PublishResult,
} from '../types';
import { splitTextIntoChunks } from '../../chunk';
import { hasOnlineLocalPublisher } from '../../localPublisherAgents';
import {
    enqueueLocalPublisherJob,
    waitForLocalPublisherJob,
} from '../../localPublisherJobs';
import {
    markdownToThreadsPreviewHtml,
    markdownToThreadsText,
} from './markdown';

const THREADS_LIMIT = 500;

export class ThreadsPlatform implements Platform {
    readonly id = 'threads';
    readonly name = 'Threads';
    readonly icon = '@';
    readonly charLimit = THREADS_LIMIT;
    readonly desktopOnly = true;
    readonly setup = {
        connect: 'desktop-browser' as const,
        summary:
            'Publishes through a private browser session inside Composer Desktop.',
        steps: [
            'Click Connect Threads below and log in through the separate Composer browser window, including any 2FA step.',
        ],
        notes: [
            'The Threads login profile stays on your computer and is never uploaded to Composer.',
            'Composer Desktop must be online when a Threads publication is sent.',
        ],
    };

    isConfigured(): boolean {
        return false;
    }

    async listChannels(context?: PlatformContext): Promise<Channel[]> {
        if (!context?.accountId) return [];
        // Threads is already restricted to Desktop clients by the platform
        // registry. Keep it visible while the local publisher is starting or
        // between heartbeats; publish() performs the authoritative online
        // check immediately before enqueueing work.
        return [{ id: 'me', name: 'Local Threads profile' }];
    }

    toPreviewHtml(markdown: string): string {
        return markdownToThreadsPreviewHtml(markdown);
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        if (!context?.accountId) {
            throw new Error('Threads publishing requires a workspace');
        }
        if (content.images?.length || content.imageUrls?.length) {
            throw new Error('Local Threads image publishing is not implemented yet');
        }
        const text = markdownToThreadsText(content.markdown);
        if (!text) throw new Error('Write something first');
        if (!(await hasOnlineLocalPublisher(context.accountId, 'threads'))) {
            throw new Error('Open Composer Desktop and connect Threads first');
        }

        const results: PublishResult[] = [];
        const chunks = splitTextIntoChunks(text, THREADS_LIMIT, true);
        if (chunks.length > 1) {
            throw new Error(
                'Local Threads reply chains are not implemented yet; keep the post within 500 characters',
            );
        }
        for (const channelId of channelIds) {
            try {
                const messageIds: string[] = [];
                let link: string | undefined;
                for (const chunk of chunks) {
                    const jobId = await enqueueLocalPublisherJob({
                        accountId: context.accountId,
                        platform: 'threads',
                        operation: 'publish',
                        payload: { text: chunk },
                    });
                    const jobResult = await waitForLocalPublisherJob(
                        context.accountId,
                        jobId,
                    );
                    messageIds.push(String(jobResult.messageId));
                    link ??= jobResult.link
                        ? String(jobResult.link)
                        : undefined;
                }
                results.push({
                    platform: this.id,
                    channelId,
                    ok: true,
                    messageIds,
                    link,
                });
            } catch (error: unknown) {
                results.push({
                    platform: this.id,
                    channelId,
                    ok: false,
                    error:
                        error instanceof Error ? error.message : 'Publish failed',
                });
            }
        }
        return results;
    }
}

export function createPlatform(): Platform {
    return new ThreadsPlatform();
}
