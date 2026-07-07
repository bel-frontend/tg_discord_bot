import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { xLoginDetector } from '../src/platforms/x/loginDetector';

const DEFAULT_LOGIN_URL = 'https://x.com/login';
const DEFAULT_HOME_URL = 'https://x.com/home';
const DEFAULT_STORAGE_STATE = '/tmp/composer-x-storage-state.json';
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1000;

function envFlag(name: string): boolean {
    return process.env[name] === 'true';
}

function envNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const storageStatePath = process.env.X_STORAGE_STATE || DEFAULT_STORAGE_STATE;
const timeoutMs = envNumber('X_LOGIN_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
const reuseState = existsSync(storageStatePath) && !envFlag('X_TEST_RESET');
const executablePath = process.env.CHROME_EXECUTABLE_PATH || undefined;
const mode = reuseState ? 'reuse existing storage state' : 'interactive login';

console.log('Starting X connection smoke test');
console.log(`Storage state: ${storageStatePath}`);
console.log(`Mode: ${mode}`);

const browser = await chromium.launch({
    headless: envFlag('BROWSER_HEADLESS'),
    executablePath,
    args: ['--disable-blink-features=AutomationControlled'],
});

try {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ...(reuseState ? { storageState: storageStatePath } : {}),
    });
    const page = await context.newPage();

    await page.goto(reuseState ? DEFAULT_HOME_URL : DEFAULT_LOGIN_URL, {
        waitUntil: 'domcontentloaded',
    });

    const startedAt = Date.now();
    let connected = false;
    while (Date.now() - startedAt < timeoutMs) {
        if (await xLoginDetector.isLoggedIn(page).catch(() => false)) {
            await context.storageState({ path: storageStatePath });
            console.log('X connection OK');
            console.log(`Saved storage state to ${storageStatePath}`);
            connected = true;
            break;
        }

        if (!reuseState) {
            console.log('Waiting for X login to finish...');
        }
        await sleep(POLL_MS);
    }

    if (connected) {
        process.exitCode = 0;
    } else {
        console.error(
            reuseState
                ? 'Stored X session is not connected. ' +
                      'Run with X_TEST_RESET=true to log in again.'
                : 'Timed out waiting for X login.',
        );
        process.exitCode = 1;
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    await browser.close().catch(() => {});
}
