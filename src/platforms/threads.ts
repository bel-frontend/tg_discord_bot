import type {
    Channel,
    Platform,
    PlatformContext,
    PublishedMessageRef,
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

interface ThreadsGraphResponse {
    id?: string;
    error?: {
        message?: string;
    };
}

function graphError(
    response: Response,
    json: ThreadsGraphResponse,
    fallback: string,
): Error | null {
    if (response.ok && !json.error) return null;
    return new Error(json.error?.message || fallback);
}

export class ThreadsPlatform implements Platform {
    readonly id = 'threads';
    readonly name = 'Threads';
    readonly icon = '@';
    readonly charLimit = THREADS_LIMIT;
    readonly setup = {
        connect: 'oauth' as const,
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
                    'App secret from the Threads API product settings in Meta for Developers.',
                placeholder: 'app-secret',
            },
            {
                name: 'THREADS_ACCESS_TOKEN',
                label: 'Access token',
                required: false,
                secret: true,
                description:
                    'Long-lived token filled automatically after you connect Threads.',
                placeholder: 'THQ...',
            },
            {
                name: 'THREADS_USER_ID',
                label: 'Threads user id',
                required: false,
                description:
                    'Profile id filled automatically after you connect Threads.',
                placeholder: '12345678901234567',
            },
        ],
        steps: [
            'Set PUBLIC_BASE_URL on the Composer server to its public HTTPS origin, for example https://composer.example.com. Restart Composer after changing it.',
            'Open [Meta for Developers Apps](https://developers.facebook.com/apps/), create or select an app, and add the Threads API use case.',
            'In the Threads API settings, add https://YOUR-COMPOSER-DOMAIN/api/threads/oauth/callback as the OAuth Redirect Callback URL. It must exactly match PUBLIC_BASE_URL plus /api/threads/oauth/callback.',
            'If Meta asks for them, use https://YOUR-COMPOSER-DOMAIN/api/threads/deauthorize as the Deauthorize Callback URL and https://YOUR-COMPOSER-DOMAIN/api/threads/data-deletion as the Data Deletion Request URL.',
            'While the Meta app is in development mode, add the Threads account under App roles or Testers and accept the invitation in that account.',
            'Enable threads_basic and threads_content_publish. Production users outside the app roles may require Meta App Review and Live mode.',
            'Copy the Threads App ID and Threads App Secret from Meta into the fields below and click Save Threads.',
            'After the credentials are saved, click Connect Threads, approve access in Meta, and return to Settings. A configured access token and Threads user id confirm the connection.',
        ],
        docsUrl: 'https://developers.facebook.com/docs/threads',
        notes: [
            'Posts longer than 500 characters are split into a connected chain of replies.',
            'The official API requires a public image URL. Files uploaded only to Composer cannot be attached to Threads yet.',
            'Threads does not provide an API for editing an existing post; Composer can delete it, but cannot update it.',
            'Meta long-lived Threads tokens expire after about 60 days. Reconnect Threads before expiry; automatic token refresh is not implemented yet.',
        ],
    };

    constructor(
        private readonly accessToken = '',
        private readonly userId = '',
        private readonly graphBaseUrl =
            process.env.THREADS_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL,
    ) {}

    isConfigured(): boolean {
        return Boolean(this.accessToken && this.userId);
    }

    private async resolveConfig(context?: PlatformContext): Promise<{
        accessToken: string;
        userId: string;
    }> {
        const values = await getPlatformConfigValues(context?.accountId, this.id);
        return {
            accessToken: values.THREADS_ACCESS_TOKEN || this.accessToken,
            userId: values.THREADS_USER_ID || this.userId,
        };
    }

    async listChannels(context?: PlatformContext): Promise<Channel[]> {
        const config = await this.resolveConfig(context);
        if (!config.accessToken || !config.userId) return [];
        return [{ id: config.userId, name: 'Connected Threads profile' }];
    }

    toPreviewHtml(markdown: string): string {
        return markdownToThreadsPreviewHtml(markdown);
    }

    private endpoint(path: string): string {
        return `${this.graphBaseUrl.replace(/\/$/, '')}/${path}`;
    }

    private async graphRequest(
        path: string,
        init: RequestInit,
        fallback: string,
    ): Promise<ThreadsGraphResponse> {
        const response = await fetch(this.endpoint(path), init);
        const json = (await response.json().catch(() => ({}))) as ThreadsGraphResponse;
        const error = graphError(response, json, fallback);
        if (error) throw error;
        return json;
    }

    private async createContainer(
        userId: string,
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

        const json = await this.graphRequest(
            `${userId}/threads`,
            { method: 'POST', body },
            'Failed to create Threads media container',
        );
        if (!json.id) throw new Error('Threads did not return a media container id');
        return json.id;
    }

    private async publishContainer(
        userId: string,
        creationId: string,
        accessToken: string,
    ): Promise<string> {
        const json = await this.graphRequest(
            `${userId}/threads_publish`,
            {
                method: 'POST',
                body: new URLSearchParams({
                    access_token: accessToken,
                    creation_id: creationId,
                }),
            },
            'Failed to publish Threads post',
        );
        if (!json.id) throw new Error('Threads did not return a published post id');
        return json.id;
    }

    private async publishChunk(
        userId: string,
        accessToken: string,
        options: { text?: string; imageUrl?: string; replyToId?: string },
    ): Promise<string> {
        const creationId = await this.createContainer(
            userId,
            accessToken,
            options,
        );
        return this.publishContainer(userId, creationId, accessToken);
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const config = await this.resolveConfig(context);
        if (!config.accessToken || !config.userId) {
            throw new Error('Connect Threads in Settings before publishing');
        }

        const text = markdownToThreadsText(content.markdown);
        const imageUrls = content.imageUrls ?? [];
        if (content.images?.length) {
            throw new Error(
                'Threads requires public image URLs; uploaded files are not supported yet',
            );
        }
        if (imageUrls.length > 1) {
            throw new Error('Threads currently supports one image URL per post');
        }
        if (!text && !imageUrls.length) {
            throw new Error('Write something or add an image URL first');
        }

        const chunks = splitTextIntoChunks(text, THREADS_LIMIT, true);
        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            const id = channelId.trim() || config.userId;
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
            } catch (error: unknown) {
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: false,
                    error: error instanceof Error ? error.message : 'Publish failed',
                });
            }
        }
        return results;
    }

    async delete(
        refs: PublishedMessageRef[],
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const config = await this.resolveConfig(context);
        if (!config.accessToken || !config.userId) {
            throw new Error('Connect Threads in Settings before deleting');
        }

        const results: PublishResult[] = [];
        for (const ref of refs) {
            try {
                for (const messageId of [...ref.messageIds].reverse()) {
                    const body = new URLSearchParams({
                        access_token: config.accessToken,
                    });
                    await this.graphRequest(
                        messageId,
                        { method: 'DELETE', body },
                        'Failed to delete Threads post',
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
                    error: error instanceof Error ? error.message : 'Delete failed',
                });
            }
        }
        return results;
    }
}
