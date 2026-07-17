import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    nativeImage,
    net,
    session,
    shell,
    Tray,
} from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    connectThreads,
    disconnectThreads,
    getThreadsConnectionStatus,
    publishThreadsText,
} from './threadsSession';
import {
    connectX,
    disconnectX,
    getXConnectionStatus,
    publishXText,
} from './xSession';
import { applyPublisherConnectionChange } from './publisherConnection';

interface EnvironmentConfig {
    id: string;
    name: string;
    serverUrl: string;
    agentToken?: string;
    agentId?: string;
}

interface DesktopConfig {
    environments: EnvironmentConfig[];
    activeEnvironmentId?: string;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function configPath(): string {
    return join(app.getPath('userData'), 'config.json');
}

function readConfig(): DesktopConfig {
    if (!existsSync(configPath())) return { environments: [] };
    try {
        const parsed = JSON.parse(readFileSync(configPath(), 'utf8'));
        return Array.isArray(parsed.environments)
            ? (parsed as DesktopConfig)
            : { environments: [] };
    } catch {
        return { environments: [] };
    }
}

function writeConfig(config: DesktopConfig): void {
    writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

// When running unpackaged with COMPOSER_DESKTOP_DEV_URL set, force-select a
// matching environment entry so it behaves like any other saved environment
// (same pairing/token round-trip) instead of a separate code path.
function applyDevEnvironmentOverride(): void {
    if (app.isPackaged || !process.env.COMPOSER_DESKTOP_DEV_URL) return;
    const serverUrl = normalizeServerUrl(process.env.COMPOSER_DESKTOP_DEV_URL);
    const config = readConfig();
    let env = config.environments.find((e) => e.serverUrl === serverUrl);
    if (!env) {
        env = { id: randomUUID(), name: 'Dev (env var)', serverUrl };
        config.environments.push(env);
    }
    config.activeEnvironmentId = env.id;
    writeConfig(config);
}

function activeEnvironment(): EnvironmentConfig | undefined {
    const config = readConfig();
    return config.environments.find(
        (e) => e.id === config.activeEnvironmentId,
    );
}

function activeServerUrl(): string | undefined {
    return activeEnvironment()?.serverUrl;
}

function activeAgentToken(): string | undefined {
    return activeEnvironment()?.agentToken;
}

async function agentRequest(
    path: string,
    init: RequestInit = {},
): Promise<Record<string, unknown>> {
    const serverUrl = activeServerUrl();
    if (!serverUrl) throw new Error('Composer server is not configured');
    const agentToken = activeAgentToken();
    const response = await fetch(`${serverUrl}${path}`, {
        ...init,
        headers: {
            'content-type': 'application/json',
            ...(agentToken
                ? { 'x-local-publisher-token': agentToken }
                : {}),
            ...init.headers,
        },
    });
    const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
    >;
    if (!response.ok) {
        throw new Error(String(body.error || 'Local publisher request failed'));
    }
    return body;
}

function normalizeServerUrl(raw: string): string {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Composer server must use HTTP or HTTPS');
    }
    if (app.isPackaged && url.protocol !== 'https:') {
        throw new Error('The installed app requires an HTTPS Composer server');
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
}

function setupPagePath(): string {
    return join(app.getAppPath(), 'src', 'setup.html');
}

function environmentManagerQuery(
    extra: Record<string, string> = {},
): Record<string, string> {
    const config = readConfig();
    return {
        // The setup page only needs display metadata. Pairing credentials must
        // never be exposed in a file URL, logs, screenshots, or renderer code.
        environments: JSON.stringify(
            config.environments.map(({ id, name, serverUrl }) => ({
                id,
                name,
                serverUrl,
            })),
        ),
        activeId: config.activeEnvironmentId ?? '',
        ...extra,
    };
}

async function showEnvironmentManagerPage(
    window: BrowserWindow,
    extra: Record<string, string> = {},
): Promise<void> {
    await window.loadFile(setupPagePath(), {
        query: environmentManagerQuery(extra),
    });
}

async function loadConfiguredPage(window: BrowserWindow): Promise<void> {
    const serverUrl = activeServerUrl();
    if (serverUrl) {
        await loadServerPage(window, serverUrl);
        return;
    }
    await showEnvironmentManagerPage(window);
}

async function loadServerPage(
    window: BrowserWindow,
    serverUrl: string,
): Promise<void> {
    try {
        const response = await net.fetch(serverUrl, {
            method: 'HEAD',
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
        await window.loadURL(serverUrl);
    } catch (error) {
        const detail = error instanceof Error ? ` (${error.message})` : '';
        await showEnvironmentManagerPage(window, {
            error: `Cannot reach Composer at ${serverUrl}${detail}. Start the server or choose another address.`,
        });
    }
}

function createWindow(): BrowserWindow {
    const preload = join(app.getAppPath(), 'dist', 'preload.js');
    const window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 900,
        minHeight: 620,
        show: false,
        title: 'Composer',
        webPreferences: {
            preload,
            contextIsolation: true,
            nodeIntegration: false,
            // The renderer still has no Node access. Keeping the preload outside
            // Chromium's sandbox makes the narrow contextBridge reliable in
            // packaged and development builds alike.
            sandbox: false,
        },
    });
    window.webContents.on('preload-error', (_event, failedPath, error) => {
        console.error(`Failed to load Electron preload ${failedPath}:`, error);
    });
    window.webContents.on('did-finish-load', () => {
        void window.webContents
            .executeJavaScript(
                `typeof window.composerDesktop === 'object'`,
                true,
            )
            .then((available) => {
                console.log(
                    available
                        ? 'Electron desktop bridge ready'
                        : 'Electron desktop bridge unavailable',
                );
            });
    });
    window.webContents.setUserAgent(
        `${window.webContents.getUserAgent()} ComposerDesktop/${app.getVersion()}`,
    );
    window.once('ready-to-show', () => window.show());
    window.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        window.hide();
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });
    window.webContents.on('context-menu', (_event, params) => {
        if (!params.isEditable) return;
        Menu.buildFromTemplate([
            { role: 'undo', enabled: params.editFlags.canUndo },
            { role: 'redo', enabled: params.editFlags.canRedo },
            { type: 'separator' },
            { role: 'cut', enabled: params.editFlags.canCut },
            { role: 'copy', enabled: params.editFlags.canCopy },
            { role: 'paste', enabled: params.editFlags.canPaste },
            { type: 'separator' },
            { role: 'selectAll', enabled: params.editFlags.canSelectAll },
        ]).popup({ window });
    });
    void loadConfiguredPage(window);
    return window;
}

function markDesktopRequests(): void {
    session.defaultSession.webRequest.onBeforeSendHeaders(
        (details, callback) => {
            const serverUrl = activeServerUrl();
            if (serverUrl && details.url.startsWith(`${serverUrl}/`)) {
                details.requestHeaders['X-Composer-Client'] = 'desktop';
            }
            callback({ requestHeaders: details.requestHeaders });
        },
    );
}

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
    const serverUrl = activeServerUrl();
    if (!serverUrl || !event.sender.getURL().startsWith(`${serverUrl}/`)) {
        throw new Error('Untrusted Composer window');
    }
}

function environmentManagerWindow(
    event: Electron.IpcMainInvokeEvent,
): BrowserWindow {
    if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        !event.sender.getURL().startsWith('file:')
    ) {
        throw new Error('Untrusted environment manager');
    }
    return mainWindow;
}

function navigateAfterEnvironmentChange(window: BrowserWindow): void {
    // Let the IPC response reach the setup renderer before navigating away
    // from it. Awaiting loadURL/loadFile inside the handler destroys the
    // caller's context and makes Electron reject invoke() with ERR_FAILED.
    setTimeout(() => {
        void loadConfiguredPage(window).catch((error) => {
            console.error('Failed to load Composer environment:', error);
        });
    }, 0);
}

function registerPublisherIpc(): void {
    ipcMain.handle(
        'desktop:environment-add',
        async (event, rawName: unknown, rawServerUrl: unknown) => {
            const window = environmentManagerWindow(event);
            const config = readConfig();
            const serverUrl = normalizeServerUrl(String(rawServerUrl ?? ''));
            const name = String(rawName ?? '').trim();
            const id = randomUUID();
            config.environments.push({
                id,
                name: name || serverUrl,
                serverUrl,
            });
            config.activeEnvironmentId = id;
            writeConfig(config);
            navigateAfterEnvironmentChange(window);
            return { ok: true };
        },
    );
    ipcMain.handle(
        'desktop:environment-switch',
        async (event, rawId: unknown) => {
            const window = environmentManagerWindow(event);
            const id = String(rawId ?? '');
            const config = readConfig();
            if (
                !config.environments.some(
                    (environment) => environment.id === id,
                )
            ) {
                throw new Error('Unknown environment');
            }
            config.activeEnvironmentId = id;
            writeConfig(config);
            navigateAfterEnvironmentChange(window);
            return { ok: true };
        },
    );
    ipcMain.handle(
        'desktop:environment-remove',
        async (event, rawId: unknown) => {
            const window = environmentManagerWindow(event);
            const id = String(rawId ?? '');
            const config = readConfig();
            config.environments = config.environments.filter(
                (environment) => environment.id !== id,
            );
            if (config.activeEnvironmentId === id) {
                config.activeEnvironmentId = undefined;
            }
            writeConfig(config);
            navigateAfterEnvironmentChange(window);
            return { ok: true };
        },
    );
    ipcMain.handle('desktop:agent-status', async (event) => {
        assertTrustedRenderer(event);
        const env = activeEnvironment();
        return {
            paired: Boolean(env?.agentToken),
            agentId: env?.agentId,
        };
    });
    ipcMain.handle('desktop:agent-pair', async (event, rawCode: unknown) => {
        assertTrustedRenderer(event);
        const result = await agentRequest('/api/local-publishers/pair', {
            method: 'POST',
            body: JSON.stringify({
                code: String(rawCode ?? ''),
                name: `${process.platform} desktop`,
            }),
        });
        const config = readConfig();
        const env = config.environments.find(
            (e) => e.id === config.activeEnvironmentId,
        );
        if (env) {
            env.agentToken = String(result.token);
            env.agentId = String(result.agentId);
            writeConfig(config);
        }
        await sendHeartbeat();
        return { paired: true, agentId: result.agentId };
    });
    ipcMain.handle('desktop:threads-status', async (event) => {
        assertTrustedRenderer(event);
        return getThreadsConnectionStatus();
    });
    ipcMain.handle('desktop:threads-connect', async (event) => {
        assertTrustedRenderer(event);
        return applyPublisherConnectionChange(
            connectThreads,
            sendHeartbeat,
            getThreadsConnectionStatus,
        );
    });
    ipcMain.handle('desktop:threads-disconnect', async (event) => {
        assertTrustedRenderer(event);
        return applyPublisherConnectionChange(
            disconnectThreads,
            sendHeartbeat,
            getThreadsConnectionStatus,
        );
    });
    ipcMain.handle('desktop:x-status', async (event) => {
        assertTrustedRenderer(event);
        return getXConnectionStatus();
    });
    ipcMain.handle('desktop:x-connect', async (event) => {
        assertTrustedRenderer(event);
        return applyPublisherConnectionChange(
            connectX,
            sendHeartbeat,
            getXConnectionStatus,
        );
    });
    ipcMain.handle('desktop:x-disconnect', async (event) => {
        assertTrustedRenderer(event);
        return applyPublisherConnectionChange(
            disconnectX,
            sendHeartbeat,
            getXConnectionStatus,
        );
    });
}

async function sendHeartbeat(): Promise<void> {
    if (!activeAgentToken()) return;
    const [threads, x] = await Promise.all([
        getThreadsConnectionStatus(),
        getXConnectionStatus(),
    ]);
    await agentRequest('/api/local-publishers/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
            platforms: [
                ...(threads.connected ? ['threads'] : []),
                ...(x.connected ? ['x'] : []),
            ],
        }),
    });
}

async function processNextJob(): Promise<void> {
    if (!activeAgentToken()) return;
    const response = await agentRequest('/api/local-publishers/jobs/claim', {
        method: 'POST',
        body: '{}',
    });
    const job = response.job as
        | {
              id: string;
              platform: string;
              operation: string;
              payload: Record<string, unknown>;
              leaseToken: string;
          }
        | undefined;
    if (!job) return;
    try {
        if (job.operation !== 'publish') {
            throw new Error('Unsupported local publisher job');
        }
        const text = String(job.payload.text ?? '');
        const result =
            job.platform === 'threads'
                ? await publishThreadsText(text)
                : job.platform === 'x'
                  ? await publishXText(
                        text,
                        job.payload.replyToId
                            ? String(job.payload.replyToId)
                            : undefined,
                    )
                  : (() => {
                        throw new Error('Unsupported local publisher platform');
                    })();
        await agentRequest(
            `/api/local-publishers/jobs/${job.id}/complete`,
            {
                method: 'POST',
                body: JSON.stringify({
                    leaseToken: job.leaseToken,
                    ok: true,
                    result,
                }),
            },
        );
    } catch (error) {
        await agentRequest(
            `/api/local-publishers/jobs/${job.id}/complete`,
            {
                method: 'POST',
                body: JSON.stringify({
                    leaseToken: job.leaseToken,
                    ok: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Local publish failed',
                }),
            },
        );
    }
}

function createTray(): void {
    const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' +
        '<rect width="32" height="32" rx="8" fill="#2563eb"/>' +
        '<path d="M9 8h14v4H9zm0 6h10v4H9zm0 6h14v4H9z" fill="white"/>' +
        '</svg>';
    const icon = nativeImage.createFromDataURL(
        `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    );
    tray = new Tray(icon);
    tray.setToolTip('Composer');
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: 'Open Composer', click: () => mainWindow?.show() },
            { label: 'Switch Environment…', click: showEnvironmentManager },
            { type: 'separator' },
            {
                label: 'Clear Threads session',
                click: () => clearPlatformSession('Threads', disconnectThreads),
            },
            {
                label: 'Clear X session',
                click: () => clearPlatformSession('X', disconnectX),
            },
            { type: 'separator' },
            {
                label: 'Quit',
                click: () => {
                    quitting = true;
                    app.quit();
                },
            },
        ]),
    );
}

async function clearPlatformSession(
    name: string,
    clear: () => Promise<void>,
): Promise<void> {
    try {
        await clear();
        await dialog.showMessageBox({
            type: 'info',
            message: `${name} session cleared`,
            detail: 'Cookies, cache and stored login were wiped from this computer. You can connect again from a clean state.',
        });
    } catch (error) {
        await dialog.showMessageBox({
            type: 'error',
            message: `Could not clear ${name} session`,
            detail:
                error instanceof Error ? error.message : 'Clearing failed',
        });
    }
}

function showEnvironmentManager(): void {
    if (!mainWindow) return;
    void showEnvironmentManagerPage(mainWindow);
    mainWindow.show();
}

function createApplicationMenu(): void {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: 'Composer',
                submenu: [
                    { label: 'Open Composer', click: () => mainWindow?.show() },
                    {
                        label: 'Switch Environment…',
                        click: showEnvironmentManager,
                    },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            {
                label: 'Platforms',
                submenu: [
                    {
                        label: 'Connect Threads…',
                        click: async () => {
                            try {
                                await connectThreads();
                                await dialog.showMessageBox({
                                    type: 'info',
                                    message: 'Threads connected',
                                    detail: 'The login profile is stored only on this computer.',
                                });
                            } catch (error) {
                                await dialog.showMessageBox({
                                    type: 'error',
                                    message: 'Could not connect Threads',
                                    detail:
                                        error instanceof Error
                                            ? error.message
                                            : 'Threads login failed',
                                });
                            }
                        },
                    },
                    {
                        label: 'Threads status',
                        click: async () => {
                            const status = await getThreadsConnectionStatus();
                            await dialog.showMessageBox({
                                type: 'info',
                                message: status.connected
                                    ? 'Threads is connected'
                                    : 'Threads is not connected',
                            });
                        },
                    },
                    {
                        label: 'Disconnect Threads',
                        click: async () => {
                            await disconnectThreads();
                        },
                    },
                    { type: 'separator' },
                    {
                        label: 'Connect X…',
                        click: async () => {
                            try {
                                await connectX();
                                await dialog.showMessageBox({
                                    type: 'info',
                                    message: 'X connected',
                                    detail: 'The login profile is stored only on this computer.',
                                });
                            } catch (error) {
                                await dialog.showMessageBox({
                                    type: 'error',
                                    message: 'Could not connect X',
                                    detail:
                                        error instanceof Error
                                            ? error.message
                                            : 'X login failed',
                                });
                            }
                        },
                    },
                    {
                        label: 'X status',
                        click: async () => {
                            const status = await getXConnectionStatus();
                            await dialog.showMessageBox({
                                type: 'info',
                                message: status.connected
                                    ? 'X is connected'
                                    : 'X is not connected',
                            });
                        },
                    },
                    {
                        label: 'Disconnect X',
                        click: async () => {
                            await disconnectX();
                        },
                    },
                ],
            },
            {
                label: 'Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' },
                ],
            },
            {
                label: 'View',
                submenu: [
                    { role: 'reload' },
                    { role: 'forceReload' },
                    { role: 'toggleDevTools' },
                ],
            },
        ]),
    );
}

if (!app.requestSingleInstanceLock()) app.quit();

app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
});

void app.whenReady().then(() => {
    applyDevEnvironmentOverride();
    markDesktopRequests();
    registerPublisherIpc();
    mainWindow = createWindow();
    createApplicationMenu();
    createTray();
    setInterval(() => {
        sendHeartbeat().catch(() => {});
    }, 15_000);
    setInterval(() => {
        processNextJob().catch(() => {});
    }, 2_000);
    sendHeartbeat().catch(() => {});
});

app.on('activate', () => {
    mainWindow?.show();
});

app.on('before-quit', () => {
    quitting = true;
});
