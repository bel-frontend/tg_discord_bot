import type { BrowserWindow } from 'electron';
import {
    BrowserPublisherSession,
    humanDelay,
    waitForJavaScript,
} from '../../browserPublisherSession';

const X_HOME = 'https://x.com/home';
const xSession = new BrowserPublisherSession({
    id: 'x',
    name: 'X',
    homeUrl: X_HOME,
    loginUrl: 'https://x.com/i/flow/login',
    cookieNames: ['auth_token'],
    cookieDomains: ['x.com', 'twitter.com'],
});

function findPostId(payload: unknown): string | undefined {
    const record = payload as {
        data?: {
            create_tweet?: {
                tweet_results?: { result?: { rest_id?: unknown } };
            };
        };
    };
    const id = record?.data?.create_tweet?.tweet_results?.result?.rest_id;
    return typeof id === 'string' && /^\d+$/.test(id) ? id : undefined;
}

async function readStatusIds(window: BrowserWindow): Promise<string[]> {
    return window.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('a[href*="/status/"]'))
            .map((link) => link.href.match(/\\/status\\/(\\d+)/)?.[1])
            .filter(Boolean)`,
        true,
    );
}

async function watchCreatedPostId(window: BrowserWindow): Promise<{
    promise: Promise<string | undefined>;
    stop: () => void;
}> {
    const debug = window.webContents.debugger;
    if (!debug.isAttached()) debug.attach('1.3');
    await debug.sendCommand('Network.enable');

    let finish: (id?: string) => void = () => {};
    const promise = new Promise<string | undefined>((resolve) => {
        let settled = false;
        const complete = (id?: string) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            debug.off('message', onMessage);
            resolve(id);
        };
        finish = complete;
        const onMessage = async (
            _event: Electron.Event,
            method: string,
            params: { requestId?: string; response?: { url?: string } },
        ) => {
            if (
                method !== 'Network.responseReceived' ||
                !params.response?.url?.includes('CreateTweet') ||
                !params.requestId
            ) {
                return;
            }
            try {
                const response = (await debug.sendCommand(
                    'Network.getResponseBody',
                    { requestId: params.requestId },
                )) as { body?: string; base64Encoded?: boolean };
                const raw = response.base64Encoded
                    ? Buffer.from(response.body ?? '', 'base64').toString()
                    : response.body ?? '';
                const id = findPostId(JSON.parse(raw));
                if (id) complete(id);
            } catch {
                // The DOM confirmation below remains available as a fallback.
            }
        };
        const timeout = setTimeout(() => complete(), 30_000);
        debug.on('message', onMessage);
    });

    return {
        promise,
        stop: () => {
            finish();
            if (debug.isAttached()) debug.detach();
        },
    };
}

export async function getXConnectionStatus(): Promise<{ connected: boolean }> {
    return { connected: await xSession.isConnected() };
}

export async function connectX(): Promise<void> {
    await xSession.connect();
}

export async function disconnectX(): Promise<void> {
    await xSession.disconnect();
}

export async function publishXText(
    text: string,
    replyToId?: string,
): Promise<{ messageId: string; link: string }> {
    const window = await xSession.createAutomationWindow();
    let watcher: Awaited<ReturnType<typeof watchCreatedPostId>> | undefined;
    try {
        await window.loadURL(
            replyToId
                ? `https://x.com/i/status/${replyToId}`
                : 'https://x.com/compose/post',
        );
        await humanDelay();
        if (replyToId) {
            await waitForJavaScript<boolean>(
                window,
                `(() => {
                    const button = document.querySelector('[data-testid="reply"]');
                    if (!button) return false;
                    button.click();
                    return true;
                })()`,
            );
            await humanDelay();
        }

        await waitForJavaScript<boolean>(
            window,
            `(() => {
                const editor = document.querySelector(
                    '[data-testid="tweetTextarea_0"]'
                );
                if (!editor) return false;
                editor.focus();
                return true;
            })()`,
        );
        await humanDelay();
        await window.webContents.insertText(text);
        await humanDelay();
        const knownIds = new Set(await readStatusIds(window));
        watcher = await watchCreatedPostId(window);
        await waitForJavaScript<boolean>(
            window,
            `(() => {
                const button = document.querySelector(
                    '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'
                );
                if (!button || button.getAttribute('aria-disabled') === 'true') {
                    return false;
                }
                button.click();
                return true;
            })()`,
        );

        const networkId = await watcher.promise;
        const messageId =
            networkId ??
            (await waitForJavaScript<string>(
                window,
                `(() => {
                    const known = new Set(${JSON.stringify([...knownIds])});
                    return Array.from(document.querySelectorAll(
                        'a[href*="/status/"]'
                    ))
                        .map((link) => link.href.match(/\\/status\\/(\\d+)/)?.[1])
                        .find((id) => id && id !== ${JSON.stringify(replyToId)} &&
                            !known.has(id)) || null;
                })()`,
                30_000,
            ));
        return {
            messageId,
            link: `https://x.com/i/status/${messageId}`,
        };
    } finally {
        watcher?.stop();
        if (!window.isDestroyed()) window.destroy();
    }
}
