import type {
    Channel,
    Platform,
    PlatformContext,
    PublishContent,
    PublishResult,
} from './types';
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
                name: 'THREADS_APP_ID',
                label: 'Threads API app id',
                required: true,
                description:
                    'App id from the Threads API product settings in Meta for Developers.',
                placeholder: '123456789012345',
            },
            {
                name: 'THREADS_APP_SECRET',
                label: 'Threads API app secret',
                required: true,
                secret: true,
                description:
                    'App secret from the Threads API product settings. Meta documents this as separate from the regular app secret.',
                placeholder: 'app-secret',
            },
            {
                name: 'THREADS_ACCESS_TOKEN',
                label: 'Access token',
                required: false,
                secret: true,
                description:
                    'Long-lived Threads Graph API user access token. The Connect Threads button can fill this after app credentials are saved.',
                placeholder: 'EAAB...',
            },
            {
                name: 'THREADS_USER_ID',
                label: 'Threads user id',
                required: false,
                description:
                    'Threads profile id used in Graph API publishing paths. OAuth fills this automatically.',
                placeholder: '12345678901234567',
            },
        ],
        steps: [
            'Open [Meta for Developers Apps](https://developers.facebook.com/apps/). If the list is empty, click Create app first; the Threads API settings only appear inside an app.',
            'Add the Threads API product/use case to that app and use the Threads API app id and app secret shown there. Meta documents these as separate from the regular app id and app secret.',
            'Configure OAuth redirect URLs for the Threads API: /api/threads/oauth/callback for redirects, /api/threads/deauthorize for app removal, and /api/threads/data-deletion for data deletion. Meta does not support localhost redirect URLs for Threads OAuth; use an HTTPS domain, even for local testing.',
            'Request the scopes needed for publishing, including threads_basic and threads_content_publish, for the Threads account that will post.',
            'Save the Threads API app id and app secret here, then click Connect Threads to authorize the posting account.',
            'Go to Resources and add your Threads profile as a resource, using that same user id.',
        ],
        docsUrl: 'https://developers.facebook.com/docs/threads',
        notes: [
            'Posts longer than 500 characters are automatically split into a connected thread of replies.',
            'Threads image publishing requires a public image_url. Local uploaded files in Composer are not sent to Threads yet.',
            'Updates and deletes are not enabled in this adapter yet.',
            'A blank Apps page in Meta for Developers is normal before you create or select an app; it is not evidence of a fake site by itself.',
        ],
    };

    constructor(
        private accessToken = '',
        private userId = '',
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

    async listChannels(context?: PlatformContext): Promise<Channel[]> {
        const config = await this.resolveConfig(context);
        if (!config.userId) return [];
        return [{ id: config.userId, name: 'Threads profile' }];
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
