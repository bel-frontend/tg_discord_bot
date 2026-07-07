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
const MORE_BUTTON_SELECTOR = '[data-testid="caret"]';
const DELETE_MENU_ITEM_SELECTOR =
    '[role="menuitem"]:has-text("Delete"), ' +
    '[role="menuitem"]:has-text("Выдаліць"), ' +
    '[role="menuitem"]:has-text("Удалить")';
const CONFIRM_DELETE_SELECTOR = '[data-testid="confirmationSheetConfirm"]';
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

async function readPostedId(page: Page): Promise<string | null> {
    // After posting, X shows a confirmation toast with a "View" link to the new post.
    const href = await page
        .locator(POSTED_LINK_SELECTOR)
        .first()
        .getAttribute('href')
        .catch(() => null);
    const match = href?.match(/status\/(\d+)/);
    return match?.[1] ?? null;
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
    await postButton.click();
    await page.waitForSelector(POSTED_LINK_SELECTOR, {
        timeout: postConfirmTimeoutMs(),
    });
    await actionDelay();

    const postedId = await readPostedId(page);
    if (!postedId) throw new Error('Could not confirm the post was published');
    return postedId;
}

async function deletePost(page: Page, messageId: string): Promise<void> {
    await page.goto(`https://x.com/i/status/${messageId}`, {
        waitUntil: 'domcontentloaded',
    });
    await actionDelay();

    const moreButton = page.locator(MORE_BUTTON_SELECTOR).first();
    await moreButton.waitFor({ state: 'visible', timeout: 30_000 });
    await moreButton.click();
    await actionDelay();

    const deleteItem = page.locator(DELETE_MENU_ITEM_SELECTOR).first();
    await deleteItem.waitFor({ state: 'visible', timeout: 30_000 });
    await deleteItem.click();
    await actionDelay();

    const confirmButton = page.locator(CONFIRM_DELETE_SELECTOR).first();
    await confirmButton.waitFor({ state: 'visible', timeout: 30_000 });
    await confirmButton.click();
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
}
