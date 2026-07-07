import { existsSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { markdownToXText } from '../src/platforms/x/markdown';

const DEFAULT_STORAGE_STATE = '/tmp/composer-x-storage-state.json';
const COMPOSE_URL = 'https://x.com/compose/post';
const TEXTAREA_SELECTOR = '[data-testid="tweetTextarea_0"]';
const POST_BUTTON_SELECTOR =
    '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]';
const POSTED_LINK_SELECTOR = 'a[href*="/status/"]';
const DEFAULT_ACTION_DELAY_MS = 900;
const DEFAULT_POST_CONFIRM_TIMEOUT_MS = 30_000;

function envFlag(name: string): boolean {
    return process.env[name] === 'true';
}

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

async function readPostedId(page: Page): Promise<string | null> {
    const href = await page
        .locator(POSTED_LINK_SELECTOR)
        .first()
        .getAttribute('href')
        .catch(() => null);
    const match = href?.match(/status\/(\d+)/);
    return match?.[1] ?? null;
}

const storageStatePath = process.env.X_STORAGE_STATE || DEFAULT_STORAGE_STATE;
const markdown = process.env.X_TEST_POST_TEXT || '';
const text = markdownToXText(markdown).trim();
const executablePath = process.env.CHROME_EXECUTABLE_PATH || undefined;
const postConfirmTimeoutMs = envNumber(
    'X_POST_CONFIRM_TIMEOUT_MS',
    DEFAULT_POST_CONFIRM_TIMEOUT_MS,
);

if (!text) {
    console.error('Set X_TEST_POST_TEXT to the exact test post text.');
    process.exit(1);
}

if (text.length > 280) {
    console.error(`X_TEST_POST_TEXT is ${text.length} chars; keep it <= 280.`);
    process.exit(1);
}

if (!existsSync(storageStatePath)) {
    console.error(
        `Missing ${storageStatePath}. Run bun run test:x-connection first.`,
    );
    process.exit(1);
}

console.log('Starting X test post');
console.log(`Storage state: ${storageStatePath}`);
console.log(`Text: ${text}`);

const browser = await chromium.launch({
    headless: envFlag('BROWSER_HEADLESS'),
    executablePath,
    args: ['--disable-blink-features=AutomationControlled'],
});

try {
    const context = await browser.newContext({
        storageState: storageStatePath,
        viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    console.log('Opening X compose dialog...');
    await page.goto(COMPOSE_URL, { waitUntil: 'domcontentloaded' });
    await actionDelay();
    const textarea = page.locator(TEXTAREA_SELECTOR).first();
    const composeVisible = await textarea
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true)
        .catch(() => false);

    if (!composeVisible) {
        throw new Error(
            `Could not open X compose box. Current URL: ${page.url()}`,
        );
    }

    console.log('Filling test post...');
    await textarea.click();
    await actionDelay();
    await textarea.fill(text);
    await actionDelay();

    console.log('Clicking Post...');
    const postButton = page.locator(POST_BUTTON_SELECTOR).first();
    await postButton.waitFor({ state: 'visible', timeout: 30_000 });
    await actionDelay();
    await postButton.click();
    await page.waitForSelector(POSTED_LINK_SELECTOR, {
        timeout: postConfirmTimeoutMs,
    });

    const postedId = await readPostedId(page);
    if (!postedId) throw new Error('Could not confirm the post was published');

    console.log('X test post published');
    console.log(`Link: https://x.com/i/status/${postedId}`);
    process.exitCode = 0;
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await browser.close().catch(() => {});
}
