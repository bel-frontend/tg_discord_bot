import { app } from 'electron';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';

const THREADS_HOME = 'https://www.threads.com/';
const THREADS_LOGIN = 'https://www.threads.com/login';
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const SESSION_COOKIE = 'sessionid';
const TEXTAREA_SELECTOR =
    '[role="dialog"] div[contenteditable="true"][role="textbox"], ' +
    'div[contenteditable="true"][data-lexical-editor="true"]';
const POST_BUTTON_SELECTOR =
    '[role="dialog"] div[role="button"]:has-text("Post"), ' +
    '[role="dialog"] div[role="button"]:has-text("Publish")';

let activeContext: BrowserContext | null = null;

function profilePath(): string {
    const path = join(app.getPath('userData'), 'browser-profiles', 'threads');
    mkdirSync(path, { recursive: true });
    return path;
}

function connectedMarkerPath(): string {
    return join(profilePath(), '.composer-connected');
}

async function hasThreadsSession(context: BrowserContext): Promise<boolean> {
    const cookies = await context.cookies();
    return cookies.some(
        (cookie) =>
            cookie.name === SESSION_COOKIE &&
            Boolean(cookie.value) &&
            ['threads.com', 'threads.net', 'instagram.com'].some((domain) =>
                cookie.domain.replace(/^\./, '').endsWith(domain),
            ),
    );
}

async function launchProfile(): Promise<BrowserContext> {
    if (activeContext) return activeContext;
    activeContext = await chromium.launchPersistentContext(profilePath(), {
        channel: 'chrome',
        headless: false,
        viewport: null,
        args: ['--disable-blink-features=AutomationControlled'],
    });
    activeContext.on('close', () => {
        activeContext = null;
    });
    return activeContext;
}

export async function getThreadsConnectionStatus(): Promise<{
    connected: boolean;
}> {
    return { connected: existsSync(connectedMarkerPath()) };
}

export async function connectThreads(): Promise<void> {
    const context = await launchProfile();
    const pages = context.pages();
    const page = pages[0] ?? (await context.newPage());
    await page.goto(
        (await hasThreadsSession(context)) ? THREADS_HOME : THREADS_LOGIN,
        { waitUntil: 'domcontentloaded' },
    );

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await hasThreadsSession(context)) {
            await page.goto(THREADS_HOME, { waitUntil: 'domcontentloaded' });
            writeFileSync(connectedMarkerPath(), new Date().toISOString());
            await context.close();
            return;
        }
        if (context.pages().length === 0) {
            throw new Error('Threads login window was closed');
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await context.close();
    throw new Error('Timed out waiting for Threads login');
}

export async function disconnectThreads(): Promise<void> {
    const context = await launchProfile();
    await context.clearCookies();
    await context.close();
    rmSync(connectedMarkerPath(), { force: true });
}

export async function publishThreadsText(text: string): Promise<{
    messageId: string;
    link: string;
}> {
    const context = await launchProfile();
    if (!(await hasThreadsSession(context))) {
        await context.close();
        rmSync(connectedMarkerPath(), { force: true });
        throw new Error('Threads session expired — reconnect in Settings');
    }
    const page = context.pages()[0] ?? (await context.newPage());
    const url = `${THREADS_HOME}intent/post?text=${encodeURIComponent(text)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const textarea = page.locator(TEXTAREA_SELECTOR).first();
    await textarea.waitFor({ state: 'visible', timeout: 30_000 });
    const knownLinks = new Set(
        await page.locator('a[href*="/post/"]').evaluateAll((links) =>
            links.map((link) => (link as HTMLAnchorElement).href),
        ),
    );
    const postButton = page.locator(POST_BUTTON_SELECTOR).first();
    await postButton.waitFor({ state: 'visible', timeout: 30_000 });
    await postButton.click();

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        const links = await page.locator('a[href*="/post/"]').evaluateAll((items) =>
            items.map((item) => (item as HTMLAnchorElement).href),
        );
        const link = links.find((candidate) => !knownLinks.has(candidate));
        const match = link?.match(/\/post\/([^/?]+)/);
        if (link && match?.[1]) {
            await context.close();
            return { messageId: match[1], link };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await context.close();
    throw new Error('Could not confirm the Threads post was published');
}
