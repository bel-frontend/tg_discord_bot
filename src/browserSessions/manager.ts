// In-process browser-session lifecycle: launches Chromium per (accountId, platform),
// drives the connect/login flow, and hands out short-lived automation pages for publish().
// This is a module-level singleton, same pattern as platforms/registry.ts's Map and
// scheduler.ts's setInterval loop — the app has no job-queue infra, and doesn't need one here.

import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import type { BrowserSessionHandle, BrowserSessionPhase, LoginDetector } from './types';
import { ReconnectRequiredError } from './types';
import type { ClientFrame, ServerFrame } from './protocol';
import { startScreencast, type ScreencastHandle } from './screencast';
import { dispatchClientFrame } from './remoteInput';
import {
    deleteBrowserSessionState,
    getBrowserSessionState,
    upsertBrowserSessionState,
} from './store';

const SWEEP_INTERVAL_MS = 60_000;

// `Number(raw) || fallback` would silently treat an explicit "0" as "unset" (0 is falsy),
// which matters here — a concurrency cap of 0 is a real, if unusual, config a test or a
// deploy might want to express.
function envNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function loginPollMs(): number {
    // Not documented in .env.example (a 1s default is fine for real logins) — this is
    // only tunable so tests don't have to sleep a full second per login-detection case.
    return envNumber('BROWSER_LOGIN_POLL_MS', 1000);
}

function maxConcurrentSessions(): number {
    return envNumber('MAX_CONCURRENT_BROWSER_SESSIONS', 3);
}

function loginTimeoutMs(): number {
    return envNumber('BROWSER_LOGIN_TIMEOUT_MS', 10 * 60_000);
}

function idleCloseMs(): number {
    return envNumber('BROWSER_IDLE_CLOSE_MS', 5 * 60_000);
}

export interface BrowserPlatformConfig {
    loginUrl: string;
    detector: LoginDetector;
}

const platformConfigs = new Map<string, BrowserPlatformConfig>();

/** Called by each browser-based platform adapter at registration time. */
export function registerBrowserPlatform(
    platform: string,
    config: BrowserPlatformConfig,
): void {
    platformConfigs.set(platform, config);
}

function requireConfig(platform: string): BrowserPlatformConfig {
    const config = platformConfigs.get(platform);
    if (!config) {
        throw new Error(`No browser-session config registered for platform "${platform}"`);
    }
    return config;
}

export interface LiveViewSink {
    send(frame: ServerFrame): void;
    close(): void;
}

interface LiveSession {
    handle: BrowserSessionHandle;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    cdp: CDPSession;
    loginPoll: ReturnType<typeof setInterval>;
    sink?: LiveViewSink;
    screencast?: ScreencastHandle;
}

interface IdleContext {
    browser: Browser;
    context: BrowserContext;
    lastActivityAt: Date;
}

const liveSessions = new Map<string, LiveSession>();
const idleContexts = new Map<string, IdleContext>();

function idleKey(accountId: string, platform: string): string {
    return `${accountId}:${platform}`;
}

function countChromiumProcesses(): number {
    return liveSessions.size + idleContexts.size;
}

async function launchBrowser(): Promise<Browser> {
    // Headful (not headless) is the point: both to give the user something real to look
    // at during login, and because headless Chromium is a known fingerprinting signal for
    // the anti-automation checks X/Reddit run. In Docker this renders into Xvfb (DISPLAY set
    // by the container entrypoint); set BROWSER_HEADLESS=true to force headless (e.g. CI).
    return chromium.launch({
        headless: process.env.BROWSER_HEADLESS === 'true',
        executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined,
        args: ['--disable-blink-features=AutomationControlled'],
    });
}

async function closeLiveSession(
    sessionId: string,
    phase: BrowserSessionPhase,
    error?: string,
): Promise<void> {
    const session = liveSessions.get(sessionId);
    if (!session) return;
    clearInterval(session.loginPoll);
    session.handle.phase = phase;
    if (error) session.handle.error = error;
    liveSessions.delete(sessionId);
    try {
        await session.browser.close();
    } catch {
        // already closed
    }
}

async function pollLogin(sessionId: string): Promise<void> {
    const session = liveSessions.get(sessionId);
    if (!session || session.handle.phase !== 'awaiting_login') return;

    const config = requireConfig(session.handle.platform);
    const loggedIn = await config.detector.isLoggedIn(session.page).catch(() => false);
    if (!loggedIn) return;

    const storageState = await session.context.storageState();
    await upsertBrowserSessionState(
        session.handle.accountId,
        session.handle.platform,
        JSON.stringify(storageState),
    );
    session.handle.phase = 'connected';
    session.handle.lastActivityAt = new Date();
    session.sink?.send({ type: 'connected' });
    session.sink?.close();
    await closeLiveSession(sessionId, 'closed');
}

/** Starts a live, watchable browser session for the user to log into `platform` with. */
export async function startConnectSession(
    accountId: string,
    platform: string,
): Promise<BrowserSessionHandle> {
    const config = requireConfig(platform);
    if (countChromiumProcesses() >= maxConcurrentSessions()) {
        throw new Error('Too many active browser sessions, try again shortly');
    }

    const browser = await launchBrowser();
    let context: BrowserContext;
    let page: Page;
    let cdp: CDPSession;
    try {
        context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        page = await context.newPage();
        cdp = await context.newCDPSession(page);
    } catch (error) {
        await browser.close().catch(() => {});
        throw error;
    }

    const sessionId = randomUUID();
    const handle: BrowserSessionHandle = {
        sessionId,
        accountId,
        platform,
        phase: 'launching',
        createdAt: new Date(),
        lastActivityAt: new Date(),
    };
    const session: LiveSession = {
        handle,
        browser,
        context,
        page,
        cdp,
        loginPoll: setInterval(() => {
            pollLogin(sessionId).catch((error) => {
                console.error(`Login poll failed for session ${sessionId}:`, error);
            });
        }, loginPollMs()),
    };
    liveSessions.set(sessionId, session);

    try {
        await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });
    } catch (error: any) {
        await closeLiveSession(sessionId, 'error', error?.message || 'Failed to open login page');
        throw error;
    }

    handle.phase = 'awaiting_login';
    return handle;
}

export function getSession(sessionId: string): BrowserSessionHandle | undefined {
    return liveSessions.get(sessionId)?.handle;
}

/** User-cancelled or explicitly closed mid-login. */
export async function closeSession(sessionId: string): Promise<void> {
    const session = liveSessions.get(sessionId);
    if (!session) return;
    session.sink?.close();
    await closeLiveSession(sessionId, 'closed');
}

export async function disconnectPlatform(
    accountId: string,
    platform: string,
): Promise<void> {
    const key = idleKey(accountId, platform);
    const idle = idleContexts.get(key);
    if (idle) {
        idleContexts.delete(key);
        await idle.browser.close().catch(() => {});
    }
    for (const [sessionId, session] of liveSessions) {
        if (session.handle.accountId === accountId && session.handle.platform === platform) {
            await closeSession(sessionId);
        }
    }
    await deleteBrowserSessionState(accountId, platform);
}

/** Attaches the live-view WebSocket to an in-progress connect session and starts streaming. */
export async function attachLiveView(sessionId: string, sink: LiveViewSink): Promise<void> {
    const session = liveSessions.get(sessionId);
    if (!session) {
        sink.close();
        return;
    }
    session.sink = sink;
    session.screencast = await startScreencast(session.cdp, (frame) => sink.send(frame));
}

export function detachLiveView(sessionId: string): void {
    const session = liveSessions.get(sessionId);
    if (!session) return;
    session.screencast?.stop().catch(() => {});
    session.sink = undefined;
    // The user closing the live-view tab before finishing login is a cancel, not a background task.
    if (session.handle.phase === 'awaiting_login') {
        closeLiveSession(sessionId, 'closed').catch(() => {});
    }
}

export function handleClientFrame(sessionId: string, frame: ClientFrame): void {
    const session = liveSessions.get(sessionId);
    if (!session) return;
    session.handle.lastActivityAt = new Date();
    if (frame.type === 'resize') {
        session.page
            .setViewportSize({ width: frame.width, height: frame.height })
            .catch(() => {});
        return;
    }
    dispatchClientFrame(session.cdp, frame).catch((error) => {
        console.error(`Failed to dispatch input for session ${sessionId}:`, error);
    });
}

/**
 * Hands adapters a page backed by the persisted, encrypted session for `publish()` calls.
 * Contexts are kept warm (no live view) for `BROWSER_IDLE_CLOSE_MS` between calls so a burst
 * of publishes doesn't relaunch Chromium each time, then swept by `sweepIdleSessions`.
 */
export async function acquireAutomationContext(
    accountId: string,
    platform: string,
    options: { closeBrowserOnRelease?: boolean } = {},
): Promise<{ page: Page; release: () => Promise<void> }> {
    const key = idleKey(accountId, platform);
    let idle = idleContexts.get(key);
    if (!idle) {
        const stateJson = await getBrowserSessionState(accountId, platform);
        if (!stateJson) {
            throw new ReconnectRequiredError(
                `No connected ${platform} session — connect it in Settings first`,
            );
        }
        if (countChromiumProcesses() >= maxConcurrentSessions()) {
            throw new Error('Too many active browser sessions, try again shortly');
        }
        let storageState;
        try {
            storageState = JSON.parse(stateJson);
        } catch {
            throw new ReconnectRequiredError(
                `${platform} session data is corrupted — reconnect in Settings`,
            );
        }
        const browser = await launchBrowser();
        let context: BrowserContext;
        try {
            context = await browser.newContext({
                storageState,
                viewport: { width: 1280, height: 800 },
            });
        } catch (error) {
            await browser.close().catch(() => {});
            throw error;
        }
        idle = { browser, context, lastActivityAt: new Date() };
        idleContexts.set(key, idle);
    }
    idle.lastActivityAt = new Date();
    const context = idle.context;
    const page = await context.newPage();
    return {
        page,
        release: async () => {
            await page.close().catch(() => {});
            if (options.closeBrowserOnRelease) {
                const stillIdle = idleContexts.get(key);
                if (stillIdle === idle) {
                    idleContexts.delete(key);
                    await idle.browser.close().catch(() => {});
                }
                return;
            }
            const stillIdle = idleContexts.get(key);
            if (stillIdle) stillIdle.lastActivityAt = new Date();
        },
    };
}

export async function sweepIdleSessions(): Promise<void> {
    const now = Date.now();

    for (const [sessionId, session] of [...liveSessions]) {
        if (
            session.handle.phase === 'awaiting_login' &&
            now - session.handle.createdAt.getTime() > loginTimeoutMs()
        ) {
            session.sink?.send({ type: 'timeout' });
            session.sink?.close();
            await closeLiveSession(sessionId, 'error', 'Login timed out');
        }
    }

    for (const [key, idle] of [...idleContexts]) {
        if (now - idle.lastActivityAt.getTime() > idleCloseMs()) {
            idleContexts.delete(key);
            await idle.browser.close().catch(() => {});
        }
    }
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;

export function startBrowserSessionSweep(): void {
    if (sweepTimer) return;
    sweepTimer = setInterval(() => {
        sweepIdleSessions().catch((error) => {
            console.error('Browser session sweep failed:', error);
        });
    }, SWEEP_INTERVAL_MS);
}

export function stopBrowserSessionSweep(): void {
    if (!sweepTimer) return;
    clearInterval(sweepTimer);
    sweepTimer = null;
}
