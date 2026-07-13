import {
    app,
    BrowserWindow,
    session,
    type Session,
    type WebContents,
} from 'electron';
import { release } from 'node:os';

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const NOT_A_BRAND_VERSION = '24';

// Sessions whose windows must present as plain Google Chrome. Populated lazily
// (session.fromPartition needs the app to be ready) so the module can be
// imported at startup.
const managedSessions = new Set<Session>();
let identityHookInstalled = false;

// Strip the Electron/app-name tokens from the real UA so the reported Chrome
// version still matches this build's actual Chromium engine.
function realisticUserAgent(contents: WebContents): string {
    const appToken = `${app.getName()}/${app.getVersion()}`;
    return contents
        .getUserAgent()
        .split(' ')
        .filter((token) => token !== appToken && !token.startsWith('Electron/'))
        .join(' ');
}

function chromeMajorVersion(userAgent: string): string {
    return userAgent.match(/Chrome\/(\d+)/)?.[1] ?? '140';
}

function clientPlatform(): { platform: string; platformVersion: string } {
    if (process.platform === 'darwin') {
        const darwinMajor = parseInt(release(), 10);
        const macMajor = Number.isFinite(darwinMajor) ? darwinMajor - 9 : 15;
        return { platform: 'macOS', platformVersion: `${macMajor}.0.0` };
    }
    if (process.platform === 'win32') {
        return { platform: 'Windows', platformVersion: '15.0.0' };
    }
    return { platform: 'Linux', platformVersion: '' };
}

// The single most important anti-detection step: Chromium inside Electron
// advertises an "Electron" brand in the Sec-CH-UA request headers AND in the
// navigator.userAgentData JS API. Overriding only the UA string leaves those
// untouched, so services like Meta's reCAPTCHA Enterprise still see "Electron"
// and loop the challenge forever. Network.setUserAgentOverride (via CDP) is the
// only Chromium mechanism that rewrites the UA string, the Sec-CH-UA headers,
// and navigator.userAgentData together and consistently.
async function applyChromeIdentity(contents: WebContents): Promise<void> {
    if (contents.isDestroyed()) return;
    const userAgent = realisticUserAgent(contents);
    contents.setUserAgent(userAgent);
    const version = chromeMajorVersion(userAgent);
    const { platform, platformVersion } = clientPlatform();
    const brands = [
        { brand: 'Chromium', version },
        { brand: 'Google Chrome', version },
        { brand: 'Not/A)Brand', version: NOT_A_BRAND_VERSION },
    ];
    const fullVersion = `${version}.0.0.0`;
    const dbg = contents.debugger;
    try {
        if (!dbg.isAttached()) dbg.attach('1.3');
    } catch {
        return;
    }
    await dbg.sendCommand('Network.enable').catch(() => {});
    await dbg
        .sendCommand('Network.setUserAgentOverride', {
            userAgent,
            acceptLanguage: `${app.getLocale() || 'en-US'},en;q=0.9`,
            userAgentMetadata: {
                brands,
                fullVersionList: brands.map((entry) => ({
                    brand: entry.brand,
                    version:
                        entry.brand === 'Not/A)Brand'
                            ? `${NOT_A_BRAND_VERSION}.0.0.0`
                            : fullVersion,
                })),
                fullVersion,
                platform,
                platformVersion,
                architecture: process.arch.includes('arm') ? 'arm' : 'x86',
                model: '',
                mobile: false,
                bitness: '64',
                wow64: false,
            },
        })
        .catch(() => {});
}

// Popups opened during login (Meta/Instagram account flows) get their own
// webContents that would otherwise leak the default Electron identity. Hook
// every webContents created in a managed session so they present as Chrome too.
function ensureIdentityHook(): void {
    if (identityHookInstalled) return;
    identityHookInstalled = true;
    app.on('web-contents-created', (_event, contents) => {
        if (!managedSessions.has(contents.session)) return;
        void applyChromeIdentity(contents);
    });
}

export function humanDelay(minMs = 350, maxMs = 900): Promise<void> {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BrowserPublisherSessionOptions {
    id: string;
    name: string;
    homeUrl: string;
    loginUrl: string;
    cookieNames: string[];
    cookieDomains: string[];
}

function browserPreferences(partition: string) {
    return {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
    };
}

export class BrowserPublisherSession {
    private readonly partition: string;
    private loginWindow: BrowserWindow | null = null;

    constructor(private readonly options: BrowserPublisherSessionOptions) {
        this.partition = `persist:composer-${options.id}`;
    }

    private get session(): Session {
        const partitioned = session.fromPartition(this.partition);
        managedSessions.add(partitioned);
        return partitioned;
    }

    private async createWindow(show: boolean): Promise<BrowserWindow> {
        // Register this partition and the popup hook before the window exists,
        // so the web-contents-created handler recognises it immediately.
        managedSessions.add(this.session);
        ensureIdentityHook();
        const window = new BrowserWindow({
            width: 1100,
            height: 820,
            minWidth: 760,
            minHeight: 600,
            show,
            title: `${this.options.name} — Composer`,
            webPreferences: browserPreferences(this.partition),
        });
        window.webContents.setWindowOpenHandler(() => ({
            action: 'allow',
            overrideBrowserWindowOptions: {
                width: 900,
                height: 760,
                webPreferences: browserPreferences(this.partition),
            },
        }));
        // Apply the Chrome identity deterministically before any navigation.
        await applyChromeIdentity(window.webContents);
        return window;
    }

    async isConnected(): Promise<boolean> {
        const cookies = await this.session.cookies.get({});
        return cookies.some(
            (cookie) =>
                this.options.cookieNames.includes(cookie.name) &&
                Boolean(cookie.value) &&
                this.options.cookieDomains.some((domain) =>
                    (cookie.domain ?? '').replace(/^\./, '').endsWith(domain),
                ),
        );
    }

    async connect(): Promise<void> {
        if (this.loginWindow && !this.loginWindow.isDestroyed()) {
            this.loginWindow.show();
            this.loginWindow.focus();
            throw new Error(`${this.options.name} login is already open`);
        }

        const window = await this.createWindow(true);
        this.loginWindow = window;
        const startUrl = (await this.isConnected())
            ? this.options.homeUrl
            : this.options.loginUrl;
        await window.loadURL(startUrl);

        const deadline = Date.now() + LOGIN_TIMEOUT_MS;
        try {
            while (Date.now() < deadline) {
                if (window.isDestroyed()) {
                    throw new Error(`${this.options.name} login window was closed`);
                }
                if (await this.isConnected()) {
                    await window.loadURL(this.options.homeUrl);
                    return;
                }
                await new Promise((resolve) => setTimeout(resolve, 1_000));
            }
            throw new Error(`Timed out waiting for ${this.options.name} login`);
        } finally {
            if (!window.isDestroyed()) window.close();
            if (this.loginWindow === window) this.loginWindow = null;
        }
    }

    // Thoroughly wipe every trace of the session: cookies, localStorage,
    // IndexedDB, service workers and cache storage (clearStorageData), the HTTP
    // cache (clearCache) and cached HTTP credentials (clearAuthCache). A partial
    // clear can leave a session the platform has already flagged, so the next
    // login attempt keeps failing. Safe to call even when never connected.
    async disconnect(): Promise<void> {
        if (this.loginWindow && !this.loginWindow.isDestroyed()) {
            this.loginWindow.close();
        }
        this.loginWindow = null;
        await this.session.clearStorageData();
        await this.session.clearCache();
        await this.session.clearAuthCache();
    }

    async createAutomationWindow(): Promise<BrowserWindow> {
        if (!(await this.isConnected())) {
            throw new Error(
                `${this.options.name} session expired — reconnect in Settings`,
            );
        }
        // Visible, not hidden: a headless-looking render is itself a known
        // fingerprinting signal for X/Threads' anti-automation checks.
        return await this.createWindow(true);
    }
}

export async function waitForJavaScript<T>(
    window: BrowserWindow,
    code: string,
    timeoutMs = 30_000,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (window.isDestroyed()) throw new Error('Browser window was closed');
        const result = (await window.webContents.executeJavaScript(
            code,
            true,
        )) as T | null | undefined;
        if (result) return result;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error('Timed out waiting for the publishing page');
}
