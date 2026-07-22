import type {
    Channel,
    Platform,
    PlatformContext,
    PublishContent,
    PublishedMessageRef,
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

function threadsPostLink(messageId: string, rootLink?: string): string {
    if (/^https:\/\//.test(messageId)) return messageId;
    if (!rootLink) {
        throw new Error('No Threads post link was stored for deletion');
    }
    const url = new URL(rootLink);
    if (!['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net'].includes(url.hostname)) {
        throw new Error('Invalid stored Threads post link');
    }
    const match = url.pathname.match(/^(\/@[^/]+\/post\/)[^/]+/);
    if (!match || !/^[A-Za-z0-9_-]+$/.test(messageId)) {
        throw new Error('Invalid stored Threads post id');
    }
    url.pathname = `${match[1]}${messageId}`;
    url.search = '';
    url.hash = '';
    return url.href;
}

export interface ThreadsPlatformDependencies {
    hasOnlineLocalPublisher: typeof hasOnlineLocalPublisher;
    enqueueLocalPublisherJob: typeof enqueueLocalPublisherJob;
    waitForLocalPublisherJob: typeof waitForLocalPublisherJob;
}

const defaultDependencies: ThreadsPlatformDependencies = {
    hasOnlineLocalPublisher,
    enqueueLocalPublisherJob,
    waitForLocalPublisherJob,
};

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

    constructor(
        private readonly dependencies: ThreadsPlatformDependencies =
            defaultDependencies,
    ) {}

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
        if (
            !(await this.dependencies.hasOnlineLocalPublisher(
                context.accountId,
                'threads',
            ))
        ) {
            throw new Error('Open Composer Desktop and connect Threads first');
        }

        const results: PublishResult[] = [];
        const chunks = splitTextIntoChunks(text, THREADS_LIMIT, true);
        for (const channelId of channelIds) {
            const messageIds: string[] = [];
            let link: string | undefined;
            try {
                let replyToLink: string | undefined;
                for (const chunk of chunks) {
                    const jobId =
                        await this.dependencies.enqueueLocalPublisherJob({
                            accountId: context.accountId,
                            platform: 'threads',
                            operation: 'publish',
                            payload: {
                                text: chunk,
                                ...(replyToLink ? { replyToLink } : {}),
                            },
                        });
                    const jobResult =
                        await this.dependencies.waitForLocalPublisherJob(
                            context.accountId,
                            jobId,
                        );
                    const messageId = String(
                        jobResult.messageId ?? '',
                    ).trim();
                    const publishedLink = String(jobResult.link ?? '').trim();
                    if (!messageId || !publishedLink) {
                        throw new Error(
                            'Local Threads publisher did not return the published post link',
                        );
                    }
                    messageIds.push(messageId);
                    link ??= publishedLink;
                    replyToLink = publishedLink;
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
                    messageIds,
                    link,
                    error:
                        error instanceof Error ? error.message : 'Publish failed',
                });
            }
        }
        return results;
    }

    async delete(
        refs: PublishedMessageRef[],
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        if (!context?.accountId) {
            throw new Error('Threads deletion requires a workspace');
        }
        if (
            !(await this.dependencies.hasOnlineLocalPublisher(
                context.accountId,
                'threads',
            ))
        ) {
            throw new Error('Open Composer Desktop and connect Threads first');
        }

        const results: PublishResult[] = [];
        for (const ref of refs) {
            try {
                // Delete replies before their parent so the chain remains
                // addressable until every stored post has been removed.
                for (const messageId of [...ref.messageIds].reverse()) {
                    const jobId =
                        await this.dependencies.enqueueLocalPublisherJob({
                            accountId: context.accountId,
                            platform: 'threads',
                            operation: 'delete',
                            payload: {
                                link: threadsPostLink(messageId, ref.link),
                            },
                        });
                    await this.dependencies.waitForLocalPublisherJob(
                        context.accountId,
                        jobId,
                    );
                }
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: true,
                    messageIds: ref.messageIds,
                });
            } catch (error: unknown) {
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    link: ref.link,
                    error:
                        error instanceof Error ? error.message : 'Delete failed',
                });
            }
        }
        return results;
    }
}

export function createPlatform(): Platform {
    return new ThreadsPlatform();
}
