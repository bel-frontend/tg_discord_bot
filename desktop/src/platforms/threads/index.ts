import type { BrowserWindow } from 'electron';
import {
    BrowserPublisherSession,
    humanDelay,
    waitForJavaScript,
} from '../../browserPublisherSession';
import {
    findCreatedThreadsPost,
    type CreatedThreadsPost,
} from './createdPost';
import { normalizeThreadsPostUrl } from './post';

const THREADS_HOME = 'https://www.threads.com/';
const threadsSession = new BrowserPublisherSession({
    id: 'threads',
    name: 'Threads',
    homeUrl: THREADS_HOME,
    loginUrl: 'https://www.threads.com/login',
    cookieNames: ['sessionid'],
    cookieDomains: ['threads.com', 'threads.net', 'instagram.com'],
});

async function watchCreatedPost(
    window: BrowserWindow,
    text: string,
): Promise<{
    promise: Promise<CreatedThreadsPost | undefined>;
    stop: () => void;
}> {
    const debug = window.webContents.debugger;
    if (!debug.isAttached()) debug.attach('1.3');
    await debug.sendCommand('Network.enable');

    let finish: (post?: CreatedThreadsPost) => void = () => {};
    const promise = new Promise<CreatedThreadsPost | undefined>((resolve) => {
        let settled = false;
        const complete = (post?: CreatedThreadsPost) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            debug.off('message', onMessage);
            resolve(post);
        };
        finish = complete;
        const onMessage = async (
            _event: Electron.Event,
            method: string,
            params: { requestId?: string; response?: { url?: string } },
        ) => {
            const url = params.response?.url;
            if (
                method !== 'Network.responseReceived' ||
                !params.requestId ||
                !url ||
                !/^https:\/\/([^/]+\.)?threads\.(com|net)\//.test(url) ||
                (!url.includes('/api/') && !url.includes('graphql'))
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
                const post = findCreatedThreadsPost(JSON.parse(raw), text);
                if (post) complete(post);
            } catch {
                // The text-matched DOM lookup below remains as a fallback.
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

export async function getThreadsConnectionStatus(): Promise<{
    connected: boolean;
}> {
    return { connected: await threadsSession.isConnected() };
}

export async function connectThreads(): Promise<void> {
    await threadsSession.connect();
}

export async function disconnectThreads(): Promise<void> {
    await threadsSession.disconnect();
}

export async function publishThreadsText(
    text: string,
    replyToLink?: string,
): Promise<{
    messageId: string;
    link: string;
}> {
    const window = await threadsSession.createAutomationWindow();
    let watcher: Awaited<ReturnType<typeof watchCreatedPost>> | undefined;
    try {
        await window.loadURL(
            replyToLink
                ? normalizeThreadsPostUrl(replyToLink)
                : `${THREADS_HOME}intent/post?text=${encodeURIComponent(text)}`,
        );
        await humanDelay();
        if (replyToLink) {
            await waitForJavaScript<boolean>(
                window,
                `(() => {
                    const replyLabels = [
                        'reply', 'odpowiedz', 'адказаць', 'ответить'
                    ];
                    const direct = document.querySelector(
                        '[aria-label="Reply"], [aria-label="Odpowiedz"], ' +
                        '[aria-label="Адказаць"], [aria-label="Ответить"]'
                    );
                    const candidates = Array.from(document.querySelectorAll(
                        '[role="button"], button'
                    ));
                    const button = direct?.closest('[role="button"], button') ||
                        candidates.find((candidate) =>
                            replyLabels.includes(
                                (candidate.getAttribute('aria-label') ||
                                    candidate.textContent || '')
                                    .trim()
                                    .toLowerCase()
                            )
                        );
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
                    '[role="dialog"] div[contenteditable="true"][role="textbox"], ' +
                    'div[contenteditable="true"][data-lexical-editor="true"]'
                );
                if (!editor) return false;
                editor.focus();
                return true;
            })()`,
        );
        if (replyToLink) {
            await humanDelay();
            await window.webContents.insertText(text);
        }
        const knownLinks = new Set(
            await window.webContents.executeJavaScript(
                `Array.from(document.querySelectorAll('a[href*="/post/"]'))
                    .map((link) => link.href)`,
                true,
            ),
        );
        await humanDelay();
        watcher = await watchCreatedPost(window, text);
        await waitForJavaScript<boolean>(
            window,
            `(() => {
                const labels = [
                    'post', 'publish', 'opublikuj',
                    'апублікаваць', 'опубликовать',
                    'reply', 'odpowiedz', 'адказаць', 'ответить'
                ];
                const buttons = Array.from(document.querySelectorAll(
                    '[role="dialog"] [role="button"], [role="dialog"] button'
                ));
                const button = buttons.find((candidate) =>
                    labels.includes((candidate.textContent || '').trim().toLowerCase())
                );
                if (!button) return false;
                button.click();
                return true;
            })()`,
        );

        const networkPost = watcher.promise.then((post) => {
            if (!post) throw new Error('Threads network confirmation timed out');
            return post;
        });
        const domPost = waitForJavaScript<CreatedThreadsPost>(
            window,
            `(() => {
                const normalize = (value) =>
                    (value || '').replace(/\\s+/g, ' ').trim();
                const expected = normalize(${JSON.stringify(text)});
                const known = new Set(${JSON.stringify([...knownLinks])});
                const links = Array.from(document.querySelectorAll(
                    'a[href*="/post/"]'
                )).filter((link) => !known.has(link.href));

                for (const link of links) {
                    let container = link;
                    for (let depth = 0; container && depth < 10; depth += 1) {
                        if (normalize(container.textContent).includes(expected)) {
                            const messageId = link.href.match(
                                /\\/post\\/([^/?]+)/
                            )?.[1];
                            if (messageId) {
                                return { messageId, link: link.href };
                            }
                        }
                        container = container.parentElement;
                    }
                }
                return null;
            })()`,
            45_000,
        );
        try {
            return await Promise.any([networkPost, domPost]);
        } catch {
            throw new Error('Could not identify the published Threads post');
        }
    } finally {
        watcher?.stop();
        if (!window.isDestroyed()) window.destroy();
    }
}
