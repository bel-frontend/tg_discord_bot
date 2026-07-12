// Client-side platform login: opens the operator's LOCAL Chrome (headed), waits for
// them to log in to the platform, then uploads the captured Playwright storageState
// to the server's /api/browser-sessions/:platform/import endpoint. Use this when the
// server can't run a headed browser (no X server / Xvfb).
//
// Usage:
//   bun scripts/connect-local.ts x [--server URL] [--token JWT]
//
// Env fallbacks:
//   COMPOSER_SERVER_URL      server base URL (default http://localhost:3000)
//   COMPOSER_TOKEN           JWT from the web app (or use email/password below)
//   COMPOSER_EMAIL           account email — script calls /api/auth/login itself
//   COMPOSER_PASSWORD        account password (prompted on stdin if unset)
//   CONNECT_LOGIN_TIMEOUT_MS how long to wait for the platform login (default 10 min)
//   CHROME_EXECUTABLE_PATH   explicit Chrome binary (default: installed Google Chrome)

import { chromium } from 'playwright-core';
import { xLoginDetector } from '../src/platforms/x/loginDetector';
import type { LoginDetector } from '../src/browserSessions/types';

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1000;

const PLATFORMS: Record<string, { loginUrl: string; detector: LoginDetector }> = {
    x: {
        loginUrl: 'https://x.com/login',
        detector: xLoginDetector,
    },
};

function envNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readArg(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    if (index === -1) return undefined;
    return process.argv[index + 1];
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

const platform = process.argv[2];
if (!platform || platform.startsWith('--') || !PLATFORMS[platform]) {
    fail(
        `Usage: bun scripts/connect-local.ts <${Object.keys(PLATFORMS).join('|')}> ` +
            '[--server URL] [--token JWT]',
    );
}
const { loginUrl, detector } = PLATFORMS[platform];

const server = (
    readArg('--server') ||
    process.env.COMPOSER_SERVER_URL ||
    'http://localhost:3000'
).replace(/\/$/, '');

async function resolveToken(): Promise<string> {
    const direct = readArg('--token') || process.env.COMPOSER_TOKEN;
    if (direct) return direct;

    const email = process.env.COMPOSER_EMAIL;
    if (!email) {
        fail(
            'No credentials: pass --token / COMPOSER_TOKEN, or set COMPOSER_EMAIL ' +
                '(+ optional COMPOSER_PASSWORD) to log in with email/password.',
        );
    }
    const password =
        process.env.COMPOSER_PASSWORD ||
        prompt(`Password for ${email}:`) ||
        fail('Password is required');

    const response = await fetch(`${server}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const body = (await response.json().catch(() => ({}))) as {
        token?: string;
        error?: string;
    };
    if (!response.ok || !body.token) {
        fail(`Login to ${server} failed (${response.status}): ${body.error || 'unknown error'}`);
    }
    return body.token;
}

// Verify auth against the server before opening a browser, so a bad token/URL fails
// fast instead of after the user has already logged in to the platform. Note the
// account needs the canManageChannels permission (the owner always has it).
async function verifyToken(token: string): Promise<void> {
    const response = await fetch(
        `${server}/api/browser-sessions/${platform}/status`,
        { headers: { authorization: `Bearer ${token}` } },
    ).catch((error) => {
        fail(`Can't reach ${server}: ${error?.message || error}`);
    });
    if (response.status === 401 || response.status === 403) {
        fail(`The server rejected the token (${response.status}) — grab a fresh one from the web app.`);
    }
    if (!response.ok) {
        fail(`Unexpected response from ${server} (${response.status}).`);
    }
}

console.log(`Server: ${server}`);
const token = await resolveToken();
await verifyToken(token);

const executablePath = process.env.CHROME_EXECUTABLE_PATH;
const browser = await chromium.launch({
    headless: false,
    // `channel` and `executablePath` are mutually exclusive in Playwright; default to
    // the locally installed Google Chrome so no bundled Chromium download is needed.
    ...(executablePath ? { executablePath } : { channel: 'chrome' }),
    args: ['--disable-blink-features=AutomationControlled'],
});

try {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    console.log(`Log in to ${platform} in the Chrome window that just opened...`);

    const timeoutMs = envNumber('CONNECT_LOGIN_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
    const startedAt = Date.now();
    let loggedIn = false;
    while (Date.now() - startedAt < timeoutMs) {
        if (await detector.isLoggedIn(page).catch(() => false)) {
            loggedIn = true;
            break;
        }
        await sleep(POLL_MS);
    }
    if (!loggedIn) {
        fail(`Timed out waiting for ${platform} login.`);
    }

    // Straight to the server (stored AES-encrypted there) — never written to disk.
    const storageState = await context.storageState();
    const response = await fetch(
        `${server}/api/browser-sessions/${platform}/import`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ storageState }),
        },
    );
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
        fail(`Import failed (${response.status}): ${body.error || 'unknown error'}`);
    }
    console.log(`Connected — ${platform} is ready to publish.`);
} finally {
    await browser.close().catch(() => {});
}
