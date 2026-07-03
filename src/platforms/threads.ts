import type {
    Channel,
    Platform,
    PlatformContext,
    PublishContent,
    PublishResult,
} from './types';
import { getConfiguredChannels } from '../channels';
import { getPlatformConfigValues } from '../platformConfigs';
import {
    markdownToThreadsPreviewHtml,
    markdownToThreadsText,
} from './threads/markdown';
import { splitTextIntoChunks } from '../chunk';

const THREADS_LIMIT = 500;
const DEFAULT_GRAPH_BASE_URL = 'https://graph.threads.net/v1.0';

interface ThreadsContainerResponse {
    id?: string;
    error?: {
        message?: string;
    };
}

interface ThreadsPublishResponse {
    id?: string;
    error?: {
        message?: string;
    };
}

function assertGraphSuccess<T extends { error?: { message?: string } }>(
    response: T,
    fallback: string,
): T {
    if (response.error) throw new Error(response.error.message || fallback);
    return response;
}

export class ThreadsPlatform implements Platform {
    readonly id = 'threads';
    readonly name = 'Threads';
    readonly icon = 'T';
    readonly charLimit = THREADS_LIMIT;
    readonly setup = {
        summary:
            'Publishes to a Threads profile through the official Threads Graph API.',
        configFields: [
            {
                name: 'THREADS_ACCESS_TOKEN',
                label: 'Access token',
                required: true,
                secret: true,
                description:
                    'Long-lived Threads Graph API user access token.',
                placeholder: 'EAAB...',
            },
            {
                name: 'THREADS_USER_ID',
                label: 'Threads user id',
                required: true,
                description:
                    'Threads profile id used in Graph API publishing paths.',
                placeholder: '12345678901234567',
            },
        ],
        steps: [
            'Create or open a [Meta developer app](https://developers.facebook.com/apps/) and add the Threads API product.',
            'Configure OAuth and request the Threads publishing permission for the account that will post.',
            'Generate a long-lived access token and copy your Threads user id.',
            'Paste both into the "Access token" and "Threads user id" fields above, then click Save.',
            'Go to Resources and add your Threads profile as a resource, using that same user id.',
        ],
        docsUrl: 'https://developers.facebook.com/docs/threads',
        notes: [
            'Posts longer than 500 characters are automatically split into a connected thread of replies.',
            'Threads image publishing requires a public image_url. Local uploaded files in Composer are not sent to Threads yet.',
            'Updates and deletes are not enabled in this adapter yet.',
        ],
    };

    constructor(
        private accessToken = process.env.THREADS_ACCESS_TOKEN || '',
        private userId = process.env.THREADS_USER_ID || '',
        private graphBaseUrl = process.env.THREADS_GRAPH_BASE_URL ||
            DEFAULT_GRAPH_BASE_URL,
    ) {}

    isConfigured(): boolean {
        return Boolean(this.accessToken && this.userId);
    }

    private async resolveConfig(context?: PlatformContext): Promise<{
        accessToken: string;
        userId: string;
    }> {
        const values = await getPlatformConfigValues(context?.userId, this.id);
        return {
            accessToken: values.THREADS_ACCESS_TOKEN || this.accessToken,
            userId: values.THREADS_USER_ID || this.userId,
        };
    }

    listChannels(): Promise<Channel[]> {
        const configured = getConfiguredChannels(this.id);
        if (configured.length) return Promise.resolve(configured);
        if (!this.userId) return Promise.resolve([]);
        return Promise.resolve([{ id: this.userId, name: 'Threads profile' }]);
    }

    toPreviewHtml(markdown: string): string {
        return markdownToThreadsPreviewHtml(markdown);
    }

    private endpoint(path: string): string {
        return `${this.graphBaseUrl.replace(/\/$/, '')}/${path}`;
    }

    /** Creates one container: the first post of a thread, or a reply to `replyToId`. */
    private async createContainer(
        channelId: string,
        accessToken: string,
        options: { text?: string; imageUrl?: string; replyToId?: string },
    ): Promise<string> {
        const body = new URLSearchParams({
            access_token: accessToken,
            media_type: options.imageUrl ? 'IMAGE' : 'TEXT',
        });
        if (options.text) body.set('text', options.text);
        if (options.imageUrl) body.set('image_url', options.imageUrl);
        if (options.replyToId) body.set('reply_to_id', options.replyToId);

        const response = await fetch(this.endpoint(`${channelId}/threads`), {
            method: 'POST',
            body,
        });
        const json = assertGraphSuccess(
            (await response.json().catch(() => ({}))) as ThreadsContainerResponse,
            'Failed to create Threads media container',
        );
        if (!response.ok || !json.id) {
            throw new Error('Failed to create Threads media container');
        }
        return json.id;
    }

    private async publishContainer(
        channelId: string,
        creationId: string,
        accessToken: string,
    ): Promise<string> {
        const body = new URLSearchParams({
            access_token: accessToken,
            creation_id: creationId,
        });
        const response = await fetch(
            this.endpoint(`${channelId}/threads_publish`),
            {
                method: 'POST',
                body,
            },
        );
        const json = assertGraphSuccess(
            (await response.json().catch(() => ({}))) as ThreadsPublishResponse,
            'Failed to publish Threads post',
        );
        if (!response.ok || !json.id) {
            throw new Error('Failed to publish Threads post');
        }
        return json.id;
    }

    /** Publishes one chunk, replying to `replyToId` when this isn't the thread's first post. */
    private async publishChunk(
        channelId: string,
        accessToken: string,
        options: { text?: string; imageUrl?: string; replyToId?: string },
    ): Promise<string> {
        const creationId = await this.createContainer(
            channelId,
            accessToken,
            options,
        );
        return this.publishContainer(channelId, creationId, accessToken);
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const config = await this.resolveConfig(context);
        if (!config.accessToken || !config.userId) {
            throw new Error('Threads access token and user id are not configured');
        }

        const text = markdownToThreadsText(content.markdown);
        const imageUrls = content.imageUrls ?? [];
        if (content.images?.length) {
            throw new Error(
                'Threads requires public image URLs; uploaded files are not supported yet',
            );
        }
        if (imageUrls.length > 1) {
            throw new Error(
                'Threads publishing supports one image URL per post in this adapter',
            );
        }
        if (!text && !imageUrls.length) {
            throw new Error('Write something or add an image URL first');
        }

        // Posts over the limit become a thread: chunk 1 publishes normally, then each
        // following chunk replies to the post published just before it.
        const chunks = splitTextIntoChunks(text, THREADS_LIMIT, true);

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            const id = channelId.trim() || config.userId;
            if (!id) continue;

            try {
                const messageIds: string[] = [];
                let replyToId: string | undefined;
                for (let i = 0; i < chunks.length; i++) {
                    const postId = await this.publishChunk(
                        id,
                        config.accessToken,
                        {
                            text: chunks[i] || undefined,
                            imageUrl: i === 0 ? imageUrls[0] : undefined,
                            replyToId,
                        },
                    );
                    messageIds.push(postId);
                    replyToId = postId;
                }
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: true,
                    messageIds,
                });
            } catch (error: any) {
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: false,
                    error: error?.message || 'Publish failed',
                });
            }
        }
        return results;
    }
}
