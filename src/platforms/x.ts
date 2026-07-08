import type { Page } from 'playwright-core';
import type {
    Channel,
    Platform,
    PlatformContext,
    PublishedMessageRef,
    PublishContent,
    PublishResult,
} from './types';
import { getBrowserSessionStatus, registerBrowserPlatform } from '../browserSessions';
import {
    ReconnectRequiredError,
    withAutomationPage,
} from './browserPlatformHelpers';
import { markdownToXPreviewHtml, markdownToXText } from './x/markdown';
import { xLoginDetector } from './x/loginDetector';
import { splitTextIntoChunks } from '../chunk';

const X_LIMIT = 280;
const LOGIN_URL = 'https://x.com/login';
const COMPOSE_URL = 'https://x.com/compose/post';
const TEXTAREA_SELECTOR = '[data-testid="tweetTextarea_0"]';
const FILE_INPUT_SELECTOR = 'input[data-testid="fileInput"]';
// Both selectors exist depending on whether the compose box is inline or a modal.
const POST_BUTTON_SELECTOR =
    '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';
const POSTED_LINK_SELECTOR = 'a[href*="/status/"]';
const MORE_BUTTON_SELECTORS = [
    '[data-testid="caret"]',
    '[role="button"][aria-label="More"]',
    '[role="button"][aria-label="More actions"]',
    '[role="button"][aria-label="Ещё"]',
    '[role="button"][aria-label="Еще"]',
    '[role="button"][aria-label="Яшчэ"]',
];
const MORE_BUTTON_SELECTOR = MORE_BUTTON_SELECTORS.join(', ');
const DELETE_MENU_ITEM_SELECTOR =
    '[role="menuitem"]:has-text("Delete"), ' +
    '[role="menuitem"]:has-text("Выдаліць"), ' +
    '[role="menuitem"]:has-text("Удалить")';
const CONFIRM_DELETE_SELECTOR = '[data-testid="confirmationSheetConfirm"]';
const DELETE_TEXTS = ['Delete', 'Выдаліць', 'Удалить'];
const DEFAULT_ACTION_DELAY_MS = 900;
const DEFAULT_POST_CONFIRM_TIMEOUT_MS = 30_000;

registerBrowserPlatform('x', { loginUrl: LOGIN_URL, detector: xLoginDetector });

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
    const delay = envNumber('X_ACTION_DELAY_MS', DEFAULT_ACTION_DELAY_MS);
    if (delay <= 0) return;
    await sleep(delay * multiplier);
}

function postConfirmTimeoutMs(): number {
    return envNumber(
        'X_POST_CONFIRM_TIMEOUT_MS',
        DEFAULT_POST_CONFIRM_TIMEOUT_MS,
    );
}

async function readStatusIds(page: Page): Promise<string[]> {
    const hrefs = await page
        .locator(POSTED_LINK_SELECTOR)
        .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
    const ids: string[] = [];
    for (const href of hrefs) {
        const match = href?.match(/status\/(\d+)/);
        const id = match?.[1];
        if (id) ids.push(id);
    }
    return ids;
}

async function waitForNewPostedId(
    page: Page,
    knownIds: Set<string>,
    excludeId?: string,
): Promise<string | null> {
    const deadline = Date.now() + postConfirmTimeoutMs();
    while (Date.now() < deadline) {
        const ids = await readStatusIds(page);
        for (let i = ids.length - 1; i >= 0; i--) {
            const id = ids[i];
            if (id && id !== excludeId && !knownIds.has(id)) return id;
        }
        await sleep(500);
    }
    return null;
}

async function postChunk(
    page: Page,
    text: string,
    images: PublishContent['images'],
    replyToId?: string,
): Promise<string> {
    await page.goto(
        replyToId ? `https://x.com/i/status/${replyToId}` : COMPOSE_URL,
        { waitUntil: 'domcontentloaded' },
    );
    await actionDelay();

    if (replyToId) {
        await page.locator('[data-testid="reply"]').first().click();
        await actionDelay();
    }

    const textarea = page.locator(TEXTAREA_SELECTOR).first();
    await textarea.waitFor({ state: 'visible', timeout: 30_000 });
    await textarea.click();
    await actionDelay();
    await textarea.fill(text);
    await actionDelay();

    if (images?.length) {
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
    const knownIds = new Set(await readStatusIds(page));
    await postButton.click();
    const postedId = await waitForNewPostedId(page, knownIds, replyToId);
    await actionDelay();

    if (!postedId) throw new Error('Could not confirm the post was published');
    return postedId;
}

function moreButtonSelectorForPost(messageId: string): string {
    const articleSelector = `article:has(a[href*="/status/${messageId}"])`;
    return MORE_BUTTON_SELECTORS.map(
        (selector) => `${articleSelector} ${selector}`,
    ).join(', ');
}

async function clickPostMoreMenu(page: Page, messageId: string): Promise<void> {
    const moreButton = page.locator(moreButtonSelectorForPost(messageId)).first();
    const clickedBySelector = await moreButton
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(async () => {
            await moreButton.click();
            return true;
        })
        .catch(() => false);
    if (clickedBySelector) return;

    const clickedByDom = await page.evaluate((targetId) => {
        const roots = Array.from(document.querySelectorAll('article'));
        const root =
            roots.find((article) =>
                Array.from(
                    article.querySelectorAll<HTMLAnchorElement>(
                        'a[href*="/status/"]',
                    ),
                ).some((anchor) => anchor.href.includes(`/status/${targetId}`)),
            ) ?? roots[0];
        if (!root) return false;

        const buttons = Array.from(
            root.querySelectorAll<HTMLElement>(
                '[role="button"], button, [aria-haspopup="menu"]',
            ),
        )
            .map((element) => {
                const rect = element.getBoundingClientRect();
                const ariaLabel = element.getAttribute('aria-label') || '';
                const testId = element.getAttribute('data-testid') || '';
                return {
                    element,
                    ariaLabel,
                    testId,
                    hasPopup: element.getAttribute('aria-haspopup') === 'menu',
                    text: (element.textContent || '').trim(),
                    x: rect.x,
                    y: rect.y,
                    visible: rect.width > 0 && rect.height > 0,
                };
            })
            .filter((candidate) => candidate.visible);

        const moreLabels = ['more', 'more actions', 'ещё', 'еще', 'яшчэ'];
        const exactCaret = buttons.find((button) => button.testId === 'caret');
        const labelledMore = buttons.find((button) => {
            const label = button.ariaLabel.toLowerCase();
            return moreLabels.some((text) => label.includes(text));
        });
        const menuCandidate = buttons
            .filter((button) => button.hasPopup)
            .sort((a, b) => b.x - a.x || a.y - b.y)[0];
        const candidate = exactCaret ?? labelledMore ?? menuCandidate;
        if (!candidate) return false;
        candidate.element.click();
        return true;
    }, messageId);

    if (!clickedByDom) {
        throw new Error(`Could not find the X post menu for ${messageId}`);
    }
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
        if (clicked) return;
        await sleep(250);
    }
    throw new Error(`Could not find ${description}`);
}

async function deletePost(page: Page, messageId: string): Promise<void> {
    await page.goto(`https://x.com/i/status/${messageId}`, {
        waitUntil: 'domcontentloaded',
    });
    await actionDelay();

    await clickPostMoreMenu(page, messageId);
    await actionDelay();

    const deleteItem = page.locator(DELETE_MENU_ITEM_SELECTOR).first();
    await deleteItem.waitFor({ state: 'visible', timeout: 30_000 });
    await deleteItem.click();
    await actionDelay();

    const confirmButton = page.locator(CONFIRM_DELETE_SELECTOR).first();
    const confirmedBySelector = await confirmButton
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(async () => {
            await confirmButton.click();
            return true;
        })
        .catch(() => false);
    if (!confirmedBySelector) {
        await clickByTextInDom(
            page,
            '[role="dialog"] [role="button"], [role="alertdialog"] [role="button"], button',
            DELETE_TEXTS,
            'the X delete confirmation button',
        );
    }
    await actionDelay(2);
}

export class XPlatform implements Platform {
    readonly id = 'x';
    readonly name = 'X';
    readonly icon = '𝕏';
    readonly charLimit = X_LIMIT;
    readonly setup = {
        connect: 'browser' as const,
        summary:
            'Publishes by driving your own logged-in X session in a real browser — no developer API access required.',
        steps: [
            'Click Connect below to open a live browser session.',
            'Log in to X as you normally would, including any 2FA or verification step.',
            'Once your feed loads, the session closes automatically and X is ready to publish to.',
        ],
        notes: [
            'This automates your real account through the actual X website rather than an official API, so it can break if X changes its page layout, and may occasionally be challenged by X\'s anti-automation checks.',
            "If a publish fails with a session/reconnect error, click Connect again to log back in.",
            `Posts longer than ${X_LIMIT} characters are split into a reply thread.`,
        ],
    };

    isConfigured(): boolean {
        // Per-account connection state can't be known without accountId (see PlatformContext
        // note in types.ts); the Settings UI uses GET /api/browser-sessions/x/status instead.
        return false;
    }

    async listChannels(context?: PlatformContext): Promise<Channel[]> {
        if (!context?.accountId) return [];
        const status = await getBrowserSessionStatus(context.accountId, 'x');
        if (status?.status !== 'connected') return [];
        return [{ id: 'me', name: 'Connected X account' }];
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
            throw new Error('X publishing requires an account context');
        }
        const accountId = context.accountId;

        const text = markdownToXText(content.markdown);
        if (!text && !content.images?.length) {
            throw new Error('Write something or add an image first');
        }
        const chunks = splitTextIntoChunks(text, X_LIMIT, true);

        const results: PublishResult[] = [];
        for (const channelId of channelIds) {
            try {
                const messageIds = await withAutomationPage(
                    accountId,
                    'x',
                    (page) => xLoginDetector.isLoggedOut(page),
                    async (page) => {
                        const ids: string[] = [];
                        let replyToId: string | undefined;
                        for (let i = 0; i < chunks.length; i++) {
                            const postedId = await postChunk(
                                page,
                                chunks[i],
                                i === 0 ? content.images : undefined,
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
            throw new Error('X deleting requires an account context');
        }
        const accountId = context.accountId;

        const results: PublishResult[] = [];
        for (const ref of refs) {
            try {
                await withAutomationPage(
                    accountId,
                    'x',
                    (page) => xLoginDetector.isLoggedOut(page),
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
            throw new Error('X updating requires an account context');
        }
        const accountId = context.accountId;

        const text = markdownToXText(content.markdown);
        if (!text && !content.images?.length) {
            throw new Error('Write something or add an image first');
        }
        const chunks = splitTextIntoChunks(text, X_LIMIT, true);

        const results: PublishResult[] = [];
        for (const ref of refs) {
            try {
                const messageIds = await withAutomationPage(
                    accountId,
                    'x',
                    (page) => xLoginDetector.isLoggedOut(page),
                    async (page) => {
                        // X has no reliable edit UI to automate (real-name edit is
                        // paid-tier only), so "update" deletes the old thread and
                        // republishes fresh content in its place.
                        for (const messageId of [...ref.messageIds].reverse()) {
                            await deletePost(page, messageId);
                        }
                        const ids: string[] = [];
                        let replyToId: string | undefined;
                        for (let i = 0; i < chunks.length; i++) {
                            const postedId = await postChunk(
                                page,
                                chunks[i],
                                i === 0 ? content.images : undefined,
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
