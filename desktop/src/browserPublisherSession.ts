import { BrowserWindow, session, type Session } from 'electron';

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const CHROME_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/138.0.0.0 Safari/537.36';

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
        return session.fromPartition(this.partition);
    }

    private createWindow(show: boolean): BrowserWindow {
        const window = new BrowserWindow({
            width: 1100,
            height: 820,
            minWidth: 760,
            minHeight: 600,
            show,
            title: `${this.options.name} — Composer`,
            webPreferences: browserPreferences(this.partition),
        });
        window.webContents.setUserAgent(CHROME_USER_AGENT);
        window.webContents.setWindowOpenHandler(() => ({
            action: 'allow',
            overrideBrowserWindowOptions: {
                width: 900,
                height: 760,
                webPreferences: browserPreferences(this.partition),
            },
        }));
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

        const window = this.createWindow(true);
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

    async disconnect(): Promise<void> {
        if (this.loginWindow && !this.loginWindow.isDestroyed()) {
            this.loginWindow.close();
        }
        this.loginWindow = null;
        await this.session.clearStorageData();
    }

    async createAutomationWindow(): Promise<BrowserWindow> {
        if (!(await this.isConnected())) {
            throw new Error(
                `${this.options.name} session expired — reconnect in Settings`,
            );
        }
        return this.createWindow(false);
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
