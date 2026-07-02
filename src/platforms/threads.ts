import type {
    Channel,
    Platform,
    PublishContent,
    PublishResult,
    ValidationIssue,
} from './types';
import { getConfiguredChannels } from '../channels';
import {
    markdownToThreadsPreviewHtml,
    markdownToThreadsText,
} from './threads/markdown';

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
        env: [
            {
                name: 'THREADS_ACCESS_TOKEN',
                required: true,
                description:
                    'Long-lived Threads Graph API user access token with publishing permission.',
            },
            {
                name: 'THREADS_USER_ID',
                required: true,
                description:
                    'Threads user id used in /{threads-user-id}/threads and /threads_publish.',
            },
            {
                name: 'THREADS_CHANNEL_IDS',
                required: false,
                description:
                    'Optional picker entries. Use the Threads user id, optionally with "|Name".',
            },
        ],
        channelIdLabel: 'Threads user id',
        channelIdHelp:
            'For a single profile this is usually the same value as THREADS_USER_ID.',
        steps: [
            'Create or open a Meta developer app and add the Threads API product.',
            'Configure OAuth and request the Threads publishing permission for the account that will post.',
            'Generate a long-lived user access token and copy the Threads user id.',
            'Set THREADS_ACCESS_TOKEN and THREADS_USER_ID in .env.',
            'Add THREADS_CHANNEL_IDS or create a Threads resource on this page using the same user id.',
        ],
        docsUrl: 'https://developers.facebook.com/docs/threads',
        notes: [
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

    listChannels(): Promise<Channel[]> {
        const configured = getConfiguredChannels(this.id);
        if (configured.length) return Promise.resolve(configured);
        if (!this.userId) return Promise.resolve([]);
        return Promise.resolve([{ id: this.userId, name: 'Threads profile' }]);
    }

    toPreviewHtml(markdown: string): string {
        return markdownToThreadsPreviewHtml(markdown);
    }

    validateContent(markdown: string): ValidationIssue[] {
        const text = markdownToThreadsText(markdown);
        if (text.length <= THREADS_LIMIT) return [];
        return [
            {
                platform: this.id,
                chunk: 1,
                message: `Threads posts must be ${THREADS_LIMIT} characters or less`,
            },
        ];
    }

    private endpoint(path: string): string {
        return `${this.graphBaseUrl.replace(/\/$/, '')}/${path}`;
    }

    private async createContainer(
        channelId: string,
        content: PublishContent,
    ): Promise<string> {
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
        if (text.length > THREADS_LIMIT) {
            throw new Error(
                `Threads posts must be ${THREADS_LIMIT} characters or less`,
            );
        }

        const body = new URLSearchParams({
            access_token: this.accessToken,
            media_type: imageUrls.length ? 'IMAGE' : 'TEXT',
        });
        if (text) body.set('text', text);
        if (imageUrls[0]) body.set('image_url', imageUrls[0]);

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
    ): Promise<string> {
        const body = new URLSearchParams({
            access_token: this.accessToken,
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

    async publish(
        channelIds: string[],
        content: PublishContent,
    ): Promise<PublishResult[]> {
        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            const id = channelId.trim();
            if (!id) continue;

            try {
                const creationId = await this.createContainer(id, content);
                const postId = await this.publishContainer(id, creationId);
                results.push({
                    platform: this.id,
                    channelId: id,
                    ok: true,
                    messageIds: [postId],
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
