import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    nativeImage,
    shell,
    Tray,
} from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    connectThreads,
    disconnectThreads,
    getThreadsConnectionStatus,
    publishThreadsText,
} from './threadsSession';

interface DesktopConfig {
    serverUrl?: string;
    agentToken?: string;
    agentId?: string;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function configPath(): string {
    return join(app.getPath('userData'), 'config.json');
}

function readConfig(): DesktopConfig {
    if (!existsSync(configPath())) return {};
    try {
        return JSON.parse(readFileSync(configPath(), 'utf8')) as DesktopConfig;
    } catch {
        return {};
    }
}

function writeConfig(config: DesktopConfig): void {
    writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

async function agentRequest(
    path: string,
    init: RequestInit = {},
): Promise<Record<string, unknown>> {
    const config = readConfig();
    if (!config.serverUrl) throw new Error('Composer server is not configured');
    const response = await fetch(`${config.serverUrl}${path}`, {
        ...init,
        headers: {
            'content-type': 'application/json',
            ...(config.agentToken
                ? { 'x-local-publisher-token': config.agentToken }
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
    return join(__dirname, '..', 'src', 'setup.html');
}

async function loadConfiguredPage(window: BrowserWindow): Promise<void> {
    const serverUrl = readConfig().serverUrl;
    if (serverUrl) {
        await window.loadURL(serverUrl);
        return;
    }
    await window.loadFile(setupPagePath());
}

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 900,
        minHeight: 620,
        show: false,
        title: 'Composer',
        webPreferences: {
            preload: join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
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
    window.webContents.on('will-navigate', (event, target) => {
        const url = new URL(target);
        if (url.protocol !== 'composer-setup:') return;
        event.preventDefault();
        if (!window.webContents.getURL().startsWith('file:')) return;
        try {
            const serverUrl = normalizeServerUrl(
                url.searchParams.get('server') ?? '',
            );
            writeConfig({ serverUrl });
            void window.loadURL(serverUrl);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Invalid server URL';
            void window.loadFile(setupPagePath(), {
                query: { error: message },
            });
        }
    });
    void loadConfiguredPage(window);
    return window;
}

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
    const serverUrl = readConfig().serverUrl;
    if (!serverUrl || !event.sender.getURL().startsWith(`${serverUrl}/`)) {
        throw new Error('Untrusted Composer window');
    }
}

function registerPublisherIpc(): void {
    ipcMain.handle('desktop:agent-status', async (event) => {
        assertTrustedRenderer(event);
        const config = readConfig();
        return { paired: Boolean(config.agentToken), agentId: config.agentId };
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
        writeConfig({
            ...readConfig(),
            agentToken: String(result.token),
            agentId: String(result.agentId),
        });
        await sendHeartbeat();
        return { paired: true, agentId: result.agentId };
    });
    ipcMain.handle('desktop:threads-status', async (event) => {
        assertTrustedRenderer(event);
        return getThreadsConnectionStatus();
    });
    ipcMain.handle('desktop:threads-connect', async (event) => {
        assertTrustedRenderer(event);
        await connectThreads();
        return getThreadsConnectionStatus();
    });
    ipcMain.handle('desktop:threads-disconnect', async (event) => {
        assertTrustedRenderer(event);
        await disconnectThreads();
        return getThreadsConnectionStatus();
    });
}

async function sendHeartbeat(): Promise<void> {
    if (!readConfig().agentToken) return;
    const threads = await getThreadsConnectionStatus();
    await agentRequest('/api/local-publishers/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
            platforms: threads.connected ? ['threads'] : [],
        }),
    });
}

async function processNextJob(): Promise<void> {
    if (!readConfig().agentToken) return;
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
        if (job.platform !== 'threads' || job.operation !== 'publish') {
            throw new Error('Unsupported local publisher job');
        }
        const result = await publishThreadsText(String(job.payload.text ?? ''));
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
            { label: 'Change Composer Server…', click: showServerSetup },
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

function showServerSetup(): void {
    writeConfig({});
    void mainWindow?.loadFile(setupPagePath());
    mainWindow?.show();
}

function createApplicationMenu(): void {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: 'Composer',
                submenu: [
                    { label: 'Open Composer', click: () => mainWindow?.show() },
                    { label: 'Change Composer Server…', click: showServerSetup },
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
