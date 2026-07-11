import type { Page } from 'playwright-core';
import type {
    Channel,
    Platform,
    PlatformContext,
    PublishedMessageRef,
    PublishContent,
    PublishImage,
    PublishResult,
} from './types';
import { getBrowserSessionStatus, registerBrowserPlatform } from '../browserSessions';
import { ReconnectRequiredError, withAutomationPage } from './browserPlatformHelpers';
import { markdownToThreadsPreviewHtml, markdownToThreadsText } from './threads/markdown';
import { threadsLoginDetector } from './threads/loginDetector';
import { splitTextIntoChunks } from '../chunk';

const THREADS_LIMIT = 500;
const THREADS_BASE_URL = 'https://www.threads.com';
const LOGIN_URL = `${THREADS_BASE_URL}/login`;
const COMPOSE_URL = `${THREADS_BASE_URL}/`;
const INTENT_POST_URL = `${THREADS_BASE_URL}/intent/post`;
const NEW_THREAD_BUTTON_SELECTOR =
    '[aria-label="Create"], [aria-label="New thread"]';
const REPLY_BUTTON_SELECTOR = '[aria-label="Reply"]';
const TEXTAREA_SELECTOR =
    '[role="dialog"] div[contenteditable="true"][role="textbox"], ' +
    'div[contenteditable="true"][data-lexical-editor="true"], ' +
    'div[contenteditable="true"][aria-label*="thread" i]';
const FILE_INPUT_SELECTOR = 'input[type="file"][accept*="image"]';
const POST_BUTTON_SELECTOR =
    '[role="dialog"] div[role="button"]:has-text("Post"), ' +
    '[role="dialog"] div[role="button"]:has-text("Publish"), ' +
    '[role="dialog"] div[role="button"]:has-text("Опубликовать"), ' +
    '[role="dialog"] div[role="button"]:has-text("Апублікаваць")';
const POSTED_LINK_SELECTOR = 'a[href*="/post/"]';
const PROFILE_LINK_SELECTOR =
    'a[href^="/@"]:has-text("Profile"), ' +
    'a[href^="/@"]:has-text("Profil"), ' +
    'a[href^="/@"]:has-text("Профиль"), ' +
    'a[href^="/@"]:has-text("Профіль")';
const POST_MORE_MENU_SELECTOR = 'div[role="button"][aria-haspopup="menu"]';
const DELETE_TEXTS = ['Удалить', 'Выдаліць', 'Delete'];
const DEFAULT_ACTION_DELAY_MS = 1_200;
const DEFAULT_POST_CONFIRM_TIMEOUT_MS = 30_000;

registerBrowserPlatform('threads', {
    loginUrl: LOGIN_URL,
    detector: threadsLoginDetector,
    sessionCookies: {
        // Meta sets sessionid on .instagram.com or .threads.net/.threads.com
        // depending on how the login redirects went.
        domainSuffixes: ['threads.com', 'threads.net', 'instagram.com'],
        names: ['sessionid'],
    },
});

function envNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function actionDelay(multiplier = 1): Promise<void> {
    const delay = envNumber('THREADS_ACTION_DELAY_MS', DEFAULT_ACTION_DELAY_MS);
    if (delay <= 0) return;
    await sleep(delay * multiplier);
}

function postConfirmTimeoutMs(): number {
    return envNumber(
        'THREADS_POST_CONFIRM_TIMEOUT_MS',
        DEFAULT_POST_CONFIRM_TIMEOUT_MS,
    );
}

function normalizeThreadsHref(href: string): string {
    return href.startsWith('http') ? href : `${THREADS_BASE_URL}${href}`;
}

function readPostIdFromHref(href: string | null | undefined): string | null {
    const match = href?.match(/\/post\/([^/?]+)/);
    return match?.[1] ?? null;
}

async function readOwnProfileHref(page: Page): Promise<string | null> {
    const hrefFromDom = await page
        .evaluate(() => {
            const keywords = ['profile', 'profil', 'профиль', 'профіль'];
            const links = Array.from(
                document.querySelectorAll<HTMLAnchorElement>('a[href^="/@"]'),
            );
            const profile = links.find((anchor) => {
                const text = (anchor.textContent || '').trim().toLowerCase();
                return keywords.some((keyword) => text.includes(keyword));
            });
            return profile?.getAttribute('href') ?? null;
        })
        .catch(() => null);
    if (hrefFromDom) return normalizeThreadsHref(hrefFromDom);

    const hrefFromLocator = await page
        .locator(PROFILE_LINK_SELECTOR)
        .first()
        .getAttribute('href')
        .catch(() => null);
    return hrefFromLocator ? normalizeThreadsHref(hrefFromLocator) : null;
}

async function readOwnPostIdFromCurrentPage(
    page: Page,
    profilePath: string,
    excludeId?: string,
): Promise<string | null> {
    const hrefs = await page.evaluate((ownProfilePath) => {
        return Array.from(
            document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'),
        )
            .map((anchor) => anchor.href)
            .filter((href) => {
                const path = new URL(href).pathname;
                return path.startsWith(`${ownProfilePath}/post/`);
            });
    }, profilePath);
    // A reply chunk's page also still shows the parent post's own link (added to the DOM
    // before the new reply), so scan from the end and skip the id we just replied to —
    // otherwise we'd keep reconfirming the parent instead of the fresh chunk.
    for (let i = hrefs.length - 1; i >= 0; i--) {
        const id = readPostIdFromHref(hrefs[i]);
        if (id && id !== excludeId) return id;
    }
    return null;
}

async function pollForOwnPostId(
    page: Page,
    profilePath: string,
    timeoutMs: number,
    excludeId?: string,
): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const postId = await readOwnPostIdFromCurrentPage(page, profilePath, excludeId);
        if (postId) return postId;
        await sleep(500);
    }
    return null;
}

async function readPostedId(
    page: Page,
    excludeId?: string,
): Promise<string | null> {
    const profileHref = await readOwnProfileHref(page);
    if (!profileHref) {
        // Can't scope the search to "our" posts without knowing our own profile path —
        // fall back to whatever the compose flow just surfaced.
        const href = await page
            .locator(POSTED_LINK_SELECTOR)
            .first()
            .getAttribute('href')
            .catch(() => null);
        return readPostIdFromHref(href);
    }

    const profilePath = new URL(profileHref).pathname;
    const currentPageId = await pollForOwnPostId(page, profilePath, 8_000, excludeId);
    if (currentPageId) return currentPageId;

    await page.goto(profileHref, { waitUntil: 'domcontentloaded' });
    await actionDelay();
    return pollForOwnPostId(page, profilePath, postConfirmTimeoutMs(), excludeId);
}

/**
 * Downloads a remote image URL into an in-memory buffer, since the file input
 * can only accept bytes, not URLs.
 */
async function fetchImageAsBuffer(url: string): Promise<PublishImage> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not download image url for Threads: ${url}`);
    }
    const data = new Uint8Array(await response.arrayBuffer());
    const filename = url.split('/').pop()?.split('?')[0] || 'image';
    return {
        data,
        filename,
        contentType: response.headers.get('content-type') || undefined,
    };
}

async function postChunk(
    page: Page,
    text: string,
    images: PublishImage[] | undefined,
    replyToId?: string,
): Promise<string> {
    const usesIntentCompose = !replyToId && Boolean(text);
    const url = replyToId
        ? `${THREADS_BASE_URL}/t/${replyToId}`
        : usesIntentCompose
          ? `${INTENT_POST_URL}?text=${encodeURIComponent(text)}`
          : COMPOSE_URL;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await actionDelay();

    if (replyToId) {
        await page.locator(REPLY_BUTTON_SELECTOR).first().click();
        await actionDelay();
    } else if (!text) {
        await page.locator(NEW_THREAD_BUTTON_SELECTOR).first().click();
        await actionDelay();
    }

    const textarea = page.locator(TEXTAREA_SELECTOR).first();
    await textarea.waitFor({ state: 'visible', timeout: 30_000 });
    if (!usesIntentCompose) {
        await textarea.click();
        await actionDelay();
        await textarea.fill(text);
        await actionDelay();
    }

    if (images?.length) {
        // Real file-input upload via in-memory buffers — this is what fixes the old
        // Graph API adapter's "public image_url only" limitation.
        await page.locator(FILE_INPUT_SELECTOR).first().setInputFiles(
            images.map((image) => ({
                name: image.filename,
                mimeType: image.contentType || 'application/octet-stream',
                buffer: Buffer.from(image.data),
            })),
        );
        await actionDelay(2);
    }

    const postButton = page.locator(POST_BUTTON_SELECTOR).first();
    await postButton.waitFor({ state: 'visible', timeout: 30_000 });
    await actionDelay();
    await postButton.click();
    await page.waitForSelector(POSTED_LINK_SELECTOR, {
        timeout: postConfirmTimeoutMs(),
    });
    await actionDelay();

    const postedId = await readPostedId(page, replyToId);
    if (!postedId) throw new Error('Could not confirm the post was published');
    return postedId;
}

async function clickPostMoreMenu(page: Page): Promise<void> {
    const index = await page.evaluate(() => {
        const candidates = Array.from(
            document.querySelectorAll<HTMLElement>(
                'div[role="button"][aria-haspopup="menu"]',
            ),
        )
            .map((element, index) => {
                const rect = element.getBoundingClientRect();
                return {
                    index,
                    x: rect.x,
                    y: rect.y,
                    visible: rect.width > 0 && rect.height > 0,
                };
            })
            .filter((candidate) => candidate.visible);

        const postMenu = candidates
            .filter((candidate) => candidate.x > 200 && candidate.y > 50)
            .sort((a, b) => a.y - b.y)[0];
        return postMenu?.index ?? null;
    });
    if (index === null) {
        throw new Error('Could not find the Threads post menu');
    }
    await page.locator(POST_MORE_MENU_SELECTOR).nth(index).click();
}

async function clickByTextInDom(
    page: Page,
    rootSelector: string,
    texts: string[],
    description: string,
): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        const clicked = await page.evaluate(
            ({ root, labels }) => {
                const candidates = Array.from(
                    document.querySelectorAll<HTMLElement>(root),
                );
                const element = candidates.find((candidate) => {
                    const rect = candidate.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) return false;
                    const text = (candidate.textContent || '').trim();
                    return labels.some((label) => text.includes(label));
                });
                if (!element) return false;
                element.click();
                return true;
            },
            { root: rootSelector, labels: texts },
        );
        if (clicked) {
            return;
        }
        await sleep(250);
    }
    throw new Error(`Could not find ${description}`);
}

async function deletePost(page: Page, messageId: string): Promise<void> {
    await page.goto(`${THREADS_BASE_URL}/t/${messageId}`, {
        waitUntil: 'domcontentloaded',
    });
    await actionDelay();

    await clickPostMoreMenu(page);
    await sleep(600);

    await clickByTextInDom(
        page,
        '[role="menuitem"]',
        DELETE_TEXTS,
        'the Threads delete menu item',
    );
    await sleep(600);

    await clickByTextInDom(
        page,
        '[role="dialog"] div[role="button"]',
        DELETE_TEXTS,
        'the Threads delete confirmation button',
    );
    await actionDelay();
}

export class ThreadsPlatform implements Platform {
    readonly id = 'threads';
    readonly name = 'Threads';
    readonly icon = '@';
    readonly charLimit = THREADS_LIMIT;
    readonly setup = {
        connect: 'browser' as const,
        summary:
            'Publishes by driving your own logged-in Threads session in a real browser — no developer API access required.',
        steps: [
            'Click Connect below to open a live browser session.',
            'Log in to Threads as you normally would, including any 2FA or verification step.',
            'Once your feed loads, the session closes automatically and Threads is ready to publish to.',
        ],
        notes: [
            'This automates your real account through the actual Threads website rather than an official API, so it can break if Threads changes its page layout, and may occasionally be challenged by anti-automation checks.',
            'If a publish fails with a session/reconnect error, click Connect again to log back in.',
            `Posts longer than ${THREADS_LIMIT} characters are split into a threaded chain of replies.`,
        ],
    };

    isConfigured(): boolean {
        // Per-account connection state can't be known without accountId; the Settings
        // UI uses GET /api/browser-sessions/threads/status instead.
        return false;
    }

    async listChannels(context?: PlatformContext): Promise<Channel[]> {
        if (!context?.accountId) return [];
        const status = await getBrowserSessionStatus(context.accountId, 'threads');
        if (status?.status !== 'connected') return [];
        return [{ id: 'me', name: 'Connected Threads account' }];
    }

    toPreviewHtml(markdown: string): string {
        return markdownToThreadsPreviewHtml(markdown);
    }

    buildMessageLink(_channelId: string, messageId: string): string | null {
        return `${THREADS_BASE_URL}/t/${messageId}`;
    }

    private async resolveImages(content: PublishContent): Promise<PublishImage[]> {
        const uploaded = content.images ?? [];
        const remote = content.imageUrls?.length
            ? await Promise.all(content.imageUrls.map(fetchImageAsBuffer))
            : [];
        return [...uploaded, ...remote];
    }

    async publish(
        channelIds: string[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        if (!context?.accountId) {
            throw new Error('Threads publishing requires an account context');
        }
        const accountId = context.accountId;

        const text = markdownToThreadsText(content.markdown);
        const images = await this.resolveImages(content);
        if (!text && !images.length) {
            throw new Error('Write something or add an image first');
        }
        const chunks = splitTextIntoChunks(text, THREADS_LIMIT, true);

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            try {
                const messageIds = await withAutomationPage(
                    accountId,
                    'threads',
                    (page) => threadsLoginDetector.isLoggedOut(page),
                    async (page) => {
                        const ids: string[] = [];
                        let replyToId: string | undefined;
                        for (let i = 0; i < chunks.length; i++) {
                            const postedId = await postChunk(
                                page,
                                chunks[i],
                                i === 0 ? images : undefined,
                                replyToId,
                            );
                            ids.push(postedId);
                            replyToId = postedId;
                        }
                        return ids;
                    },
                );
                results.push({
                    platform: this.id,
                    channelId,
                    ok: true,
                    messageIds,
                    link: this.buildMessageLink(channelId, messageIds[0]) ?? undefined,
                });
            } catch (error: any) {
                const message =
                    error instanceof ReconnectRequiredError
                        ? error.message
                        : error?.message || 'Publish failed';
                results.push({
                    platform: this.id,
                    channelId,
                    ok: false,
                    error: message,
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
            throw new Error('Threads deleting requires an account context');
        }
        const accountId = context.accountId;

        const results: PublishResult[] = [];
        for (const ref of refs) {
            try {
                await withAutomationPage(
                    accountId,
                    'threads',
                    (page) => threadsLoginDetector.isLoggedOut(page),
                    async (page) => {
                        for (const messageId of [...ref.messageIds].reverse()) {
                            await deletePost(page, messageId);
                        }
                    },
                    { markPublishedOnSuccess: false },
                );
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: true,
                    messageIds: ref.messageIds,
                });
            } catch (error: any) {
                const message =
                    error instanceof ReconnectRequiredError
                        ? error.message
                        : error?.message || 'Delete failed';
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: message,
                });
            }
        }
        return results;
    }

    async update(
        refs: PublishedMessageRef[],
        content: PublishContent,
        context?: PlatformContext,
    ): Promise<PublishResult[]> {
        if (!context?.accountId) {
            throw new Error('Threads updating requires an account context');
        }
        const accountId = context.accountId;

        const text = markdownToThreadsText(content.markdown);
        const images = await this.resolveImages(content);
        if (!text && !images.length) {
            throw new Error('Write something or add an image first');
        }
        const chunks = splitTextIntoChunks(text, THREADS_LIMIT, true);

        const results: PublishResult[] = [];
        for (const ref of refs) {
            try {
                const messageIds = await withAutomationPage(
                    accountId,
                    'threads',
                    (page) => threadsLoginDetector.isLoggedOut(page),
                    async (page) => {
                        // Threads has no reliable edit UI to automate either, so
                        // "update" deletes the old thread and republishes fresh content.
                        for (const messageId of [...ref.messageIds].reverse()) {
                            await deletePost(page, messageId);
                        }
                        const ids: string[] = [];
                        let replyToId: string | undefined;
                        for (let i = 0; i < chunks.length; i++) {
                            const postedId = await postChunk(
                                page,
                                chunks[i],
                                i === 0 ? images : undefined,
                                replyToId,
                            );
                            ids.push(postedId);
                            replyToId = postedId;
                        }
                        return ids;
                    },
                );
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: true,
                    messageIds,
                    link: this.buildMessageLink(ref.channelId, messageIds[0]) ?? undefined,
                });
            } catch (error: any) {
                const message =
                    error instanceof ReconnectRequiredError
                        ? error.message
                        : error?.message || 'Update failed';
                results.push({
                    platform: this.id,
                    channelId: ref.channelId,
                    ok: false,
                    messageIds: ref.messageIds,
                    error: message,
                });
            }
        }
        return results;
    }
}
