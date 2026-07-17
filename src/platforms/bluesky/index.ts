import { AtpAgent, RichText } from '@atproto/api';
import type {
    Channel,
    Platform,
    PlatformContext,
    PublishContent,
    PublishedMessageRef,
    PublishResult,
} from '../types';
import { getPlatformConfigValues } from '../../platformConfigs';
import { splitTextIntoChunks } from '../../chunk';
import {
    markdownToBlueskyPreviewHtml,
    markdownToBlueskyText,
} from './markdown';

const BLUESKY_LIMIT = 300; // graphemes per post; UTF-16 chunking at 300 stays within it
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_000_000; // atproto blob limit for image embeds
const DEFAULT_SERVICE = 'https://bsky.social';
const SESSION_TTL_MS = 30 * 60 * 1000;

/** The slice of AtpAgent the adapter uses; injectable for tests. */
export interface BlueskyAgentLike {
    login(opts: { identifier: string; password: string }): Promise<unknown>;
    post(
        record: Record<string, unknown>,
    ): Promise<{ uri: string; cid: string }>;
    deletePost(uri: string): Promise<void>;
    uploadBlob(
        data: Uint8Array,
        opts?: { encoding?: string },
    ): Promise<{ data: { blob: unknown } }>;
    readonly session?: { handle?: string; did?: string };
}

interface CachedSession {
    agent: BlueskyAgentLike;
    credsKey: string;
    expiresAt: number;
}

interface UploadableImage {
    data: Uint8Array;
    contentType: string;
    label: string; // filename or URL, for error messages
}

const AT_POST_URI = /^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/;

function postRkey(uri: string): string {
    return uri.slice(uri.lastIndexOf('/') + 1);
}

function isAuthError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    if (status === 401) return true;
    const message = error instanceof Error ? error.message : '';
    return (
        message.includes('Token has expired') ||
        message.includes('Authentication Required')
    );
}

/**
 * detectFacetsWithoutResolution() keeps facet detection offline (no handle→DID
 * lookups), but leaves mention facets without a DID; those would be invalid in
 * the record, so they are dropped and the mention stays plain text.
 */
function detectFacets(text: string) {
    const richText = new RichText({ text });
    richText.detectFacetsWithoutResolution();
    const facets = (richText.facets ?? [])
        .map((facet) => ({
            ...facet,
            features: facet.features.filter(
                (feature) =>
                    feature.$type !== 'app.bsky.richtext.facet#mention' ||
                    String((feature as { did?: unknown }).did ?? '').startsWith(
                        'did:',
                    ),
            ),
        }))
        .filter((facet) => facet.features.length > 0);
    return facets.length ? facets : undefined;
}

async function collectImages(content: PublishContent): Promise<UploadableImage[]> {
    const images: UploadableImage[] = [];
    for (const url of content.imageUrls ?? []) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image ${url} (${response.status})`);
        }
        images.push({
            data: new Uint8Array(await response.arrayBuffer()),
            contentType:
                response.headers.get('content-type') ?? 'image/jpeg',
            label: url,
        });
    }
    for (const image of content.images ?? []) {
        images.push({
            data: image.data,
            contentType: image.contentType ?? 'image/jpeg',
            label: image.filename,
        });
    }
    if (images.length > MAX_IMAGES) {
        throw new Error(
            `Bluesky allows at most ${MAX_IMAGES} images per post (got ${images.length})`,
        );
    }
    for (const image of images) {
        if (image.data.byteLength > MAX_IMAGE_BYTES) {
            throw new Error(
                `Image ${image.label} is larger than Bluesky's 1 MB limit`,
            );
        }
    }
    return images;
}

export class BlueskyPlatform implements Platform {
    readonly id = 'bluesky';
    readonly name = 'Bluesky';
    readonly icon = '🦋';
    readonly charLimit = BLUESKY_LIMIT;
    readonly setup = {
        summary:
            'Publishes to your Bluesky account over the AT Protocol using an app password.',
        configFields: [
            {
                name: 'BLUESKY_IDENTIFIER',
                label: 'Handle',
                required: true,
                description:
                    'Your Bluesky handle (e.g. you.bsky.social, without the @) or the email you sign in with.',
                placeholder: 'you.bsky.social',
            },
            {
                name: 'BLUESKY_APP_PASSWORD',
                label: 'App password',
                required: true,
                secret: true,
                description:
                    'A dedicated app password — not your account password.',
                placeholder: 'xxxx-xxxx-xxxx-xxxx',
            },
            {
                name: 'BLUESKY_SERVICE_URL',
                label: 'Service URL',
                required: false,
                description:
                    'Your PDS URL if self-hosted; leave empty for https://bsky.social.',
                placeholder: DEFAULT_SERVICE,
            },
        ],
        steps: [
            'Open [App Passwords](https://bsky.app/settings/app-passwords) in your Bluesky settings and create a new app password.',
            'Paste your handle and the app password above, and click Save.',
            'Your account will show up in the channel picker as a Bluesky channel.',
        ],
        docsUrl: 'https://atproto.com',
        notes: [
            `Posts are limited to ${BLUESKY_LIMIT} characters; longer posts are published as a reply thread.`,
            'Bluesky does not support editing, so published posts cannot be updated afterwards.',
            'Repeated failed logins can temporarily rate-limit the account — double-check the app password if publishing starts failing.',
        ],
    };

    private sessions = new Map<string, CachedSession>();

    constructor(
        private agentFactory: (service: string) => BlueskyAgentLike = (
            service,
        ) => new AtpAgent({ service }),
        // Fallback credentials when the workspace has none configured; used by
        // tests, mirrors the injectable-token constructor of TelegramPlatform.
        private defaults: {
            identifier?: string;
            password?: string;
            service?: string;
        } = {},
    ) {}

    private async resolveCreds(context?: PlatformContext) {
        const values = await getPlatformConfigValues(
            context?.accountId,
            this.id,
        );
        // A leading @ (habit from other platforms) makes the PDS parse the
        // identifier as an email with an empty local part — strip it.
        const identifier = (
            values.BLUESKY_IDENTIFIER?.trim() ||
            this.defaults.identifier ||
            ''
        ).replace(/^@/, '');
        return {
            identifier,
            password: values.BLUESKY_APP_PASSWORD || this.defaults.password,
            service:
                values.BLUESKY_SERVICE_URL?.trim() ||
                this.defaults.service ||
                DEFAULT_SERVICE,
        };
    }

    isConfigured(): boolean {
        // Credentials are per-workspace (Settings page), never server-wide.
        return false;
    }

    toPreviewHtml(markdown: string): string {
        return markdownToBlueskyPreviewHtml(markdown);
    }

    // No validateContent(): validation issues block publishing in the UI, and a
    // long post is not a problem — it is published as a reply thread, like X.

    buildMessageLink(_channelId: string, messageId: string): string | null {
        const match = AT_POST_URI.exec(messageId);
        if (!match) return null;
        return `https://bsky.app/profile/${match[1]}/post/${match[2]}`;
    }

    async listChannels(context?: PlatformContext): Promise<Channel[]> {
        // Deliberately offline: this runs on every channel-picker load.
        const { identifier, password } = await this.resolveCreds(context);
        if (!identifier || !password) return [];
        return [{ id: 'me', name: `Bluesky (${identifier})` }];
    }

    private async getAgent(
        context?: PlatformContext,
    ): Promise<BlueskyAgentLike> {
        const { identifier, password, service } =
            await this.resolveCreds(context);
        if (!identifier || !password) {
            throw new Error(
                'Bluesky is not configured — add your handle and app password in Settings',
            );
        }

        const accountKey = context?.accountId ?? '';
        const credsKey = `${service}\n${identifier}\n${password}`;
        const cached = this.sessions.get(accountKey);
        if (
            cached &&
            cached.credsKey === credsKey &&
            cached.expiresAt > Date.now()
        ) {
            return cached.agent;
        }

        const agent = this.agentFactory(service);
        await agent.login({ identifier, password });
        this.sessions.set(accountKey, {
            agent,
            credsKey,
            expiresAt: Date.now() + SESSION_TTL_MS,
        });
        return agent;
    }

    /** Run an operation with a session, retrying once on an expired session. */
    private async withAgent<T>(
        context: PlatformContext | undefined,
        operation: (agent: BlueskyAgentLike) => Promise<T>,
    ): Promise<T> {
        const agent = await this.getAgent(context);
        try {
            return await operation(agent);
        } catch (error) {
            if (!isAuthError(error)) throw error;
            this.sessions.delete(context?.accountId ?? '');
            return operation(await this.getAgent(context));
        }
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const text = markdownToBlueskyText(content.markdown);
        if (!text) throw new Error('Write something first');
        const chunks = splitTextIntoChunks(text, BLUESKY_LIMIT, true);
        const images = await collectImages(content);

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            try {
                const { messageIds, handle } = await this.withAgent(
                    context,
                    async (agent) => {
                        const embed = images.length
                            ? {
                                  $type: 'app.bsky.embed.images',
                                  images: await Promise.all(
                                      images.map(async (image) => ({
                                          image: (
                                              await agent.uploadBlob(
                                                  image.data,
                                                  {
                                                      encoding:
                                                          image.contentType,
                                                  },
                                              )
                                          ).data.blob,
                                          alt: '',
                                      })),
                                  ),
                              }
                            : undefined;

                        const ids: string[] = [];
                        let root: { uri: string; cid: string } | undefined;
                        let parent: { uri: string; cid: string } | undefined;
                        for (const chunk of chunks) {
                            const facets = detectFacets(chunk);
                            const response = await agent.post({
                                text: chunk,
                                ...(facets ? { facets } : {}),
                                // Images ride on the root post of the thread.
                                ...(embed && !ids.length ? { embed } : {}),
                                ...(root && parent
                                    ? { reply: { root, parent } }
                                    : {}),
                            });
                            root ??= response;
                            parent = response;
                            ids.push(response.uri);
                        }
                        return {
                            messageIds: ids,
                            handle: agent.session?.handle,
                        };
                    },
                );
                results.push({
                    platform: this.id,
                    channelId,
                    ok: true,
                    messageIds,
                    link: handle
                        ? `https://bsky.app/profile/${handle}/post/${postRkey(messageIds[0])}`
                        : (this.buildMessageLink(channelId, messageIds[0]) ??
                          undefined),
                });
            } catch (error: unknown) {
                results.push({
                    platform: this.id,
                    channelId,
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Publish failed',
                });
            }
        }
        return results;
    }

    // No update(): Bluesky posts are immutable, the registry reports that cleanly.

    async delete(
        refs: PublishedMessageRef[],
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        const results: PublishResult[] = [];
        for (const ref of refs) {
            try {
                await this.withAgent(context, async (agent) => {
                    for (const messageId of ref.messageIds) {
                        await agent.deletePost(messageId);
                    }
                });
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
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Delete failed',
                });
            }
        }
        return results;
    }
}

export function createPlatform(): Platform {
    return new BlueskyPlatform();
}
