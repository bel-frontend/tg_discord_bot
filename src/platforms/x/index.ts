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
import { markdownToXPreviewHtml, markdownToXText } from './markdown';

const X_LIMIT = 280;

export class XPlatform implements Platform {
    readonly id = 'x';
    readonly name = 'X';
    readonly icon = '𝕏';
    readonly charLimit = X_LIMIT;
    readonly desktopOnly = true;
    readonly setup = {
        connect: 'desktop-browser' as const,
        summary:
            'Publishes through a private browser session inside Composer Desktop.',
        steps: [
            'Click Connect X below and log in through the separate Composer browser window, including any 2FA step.',
        ],
        notes: [
            'The X login profile stays on your computer and is never uploaded to Composer.',
            'Composer Desktop must be online when an X publication is sent.',
            `Posts longer than ${X_LIMIT} characters are published as a reply thread.`,
        ],
    };

    isConfigured(): boolean {
        return false;
    }

    async listChannels(context?: PlatformContext): Promise<Channel[]> {
        if (!context?.accountId) return [];
        // X is already restricted to Desktop clients by the platform registry.
        // Do not tie picker visibility to the short heartbeat window: the
        // publisher may still be starting when channels are loaded, and the
        // publish path performs the authoritative online check below.
        return [{ id: 'me', name: 'Local X profile' }];
    }

    toPreviewHtml(markdown: string): string {
        return markdownToXPreviewHtml(markdown);
    }

    buildMessageLink(_channelId: string, messageId: string): string | null {
        return `https://x.com/i/status/${messageId}`;
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        if (!context?.accountId) {
            throw new Error('X publishing requires a workspace');
        }
        if (content.images?.length || content.imageUrls?.length) {
            throw new Error('Local X image publishing is not implemented yet');
        }
        const text = markdownToXText(content.markdown);
        if (!text) throw new Error('Write something first');
        if (!(await hasOnlineLocalPublisher(context.accountId, 'x'))) {
            throw new Error('Open Composer Desktop and connect X first');
        }

        const chunks = splitTextIntoChunks(text, X_LIMIT, true);
        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            try {
                const messageIds: string[] = [];
                let replyToId: string | undefined;
                for (const chunk of chunks) {
                    const jobId = await enqueueLocalPublisherJob({
                        accountId: context.accountId,
                        platform: 'x',
                        operation: 'publish',
                        payload: { text: chunk, replyToId },
                    });
                    const jobResult = await waitForLocalPublisherJob(
                        context.accountId,
                        jobId,
                    );
                    replyToId = String(jobResult.messageId);
                    messageIds.push(replyToId);
                }
                results.push({
                    platform: this.id,
                    channelId,
                    ok: true,
                    messageIds,
                    link:
                        this.buildMessageLink(channelId, messageIds[0]) ??
                        undefined,
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
    return new XPlatform();
}
