import { app, type BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    BrowserPublisherSession,
    humanDelay,
    waitForJavaScript,
} from '../../browserPublisherSession';
import {
    findCreatedThreadsPost,
    type CreatedThreadsPost,
} from './createdPost';
import {
    buildClickThreadsDeleteMenuItemScript,
    buildClickThreadsMoreScript,
    buildConfirmThreadsDeleteScript,
} from './deleteScript';
import { normalizeThreadsPostUrl } from './post';
import { buildClickThreadsReplyScript } from './replyScript';
import {
    buildClickThreadsSubmitScript,
    buildSnapshotThreadsComposerButtonsScript,
} from './submitScript';

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

async function dumpThreadsDebugSnapshot(
    window: BrowserWindow,
    label: string,
): Promise<void> {
    try {
        const directory = join(app.getPath('userData'), 'threads-debug');
        mkdirSync(directory, { recursive: true });
        const stamp = Date.now();
        const html = await window.webContents.executeJavaScript(
            'document.documentElement.outerHTML',
            true,
        );
        writeFileSync(join(directory, `${label}-${stamp}.html`), String(html));
        const image = await window.webContents.capturePage();
        writeFileSync(join(directory, `${label}-${stamp}.png`), image.toPNG());
        console.error(
            `Threads debug snapshot saved to ${directory} (${label}-${stamp}.html/.png)`,
        );
    } catch (snapshotError) {
        console.error('Failed to capture Threads debug snapshot:', snapshotError);
    }
}

async function waitForThreadsStep<T>(
    window: BrowserWindow,
    code: string,
    errorMessage: string,
    timeoutMs?: number,
): Promise<T> {
    try {
        return await waitForJavaScript<T>(window, code, timeoutMs);
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === 'Timed out waiting for the publishing page'
        ) {
            throw new Error(errorMessage);
        }
        throw error;
    }
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

export async function deleteThreadsPost(link: string): Promise<{
    deleted: true;
}> {
    const targetLink = normalizeThreadsPostUrl(link);
    const window = await threadsSession.createAutomationWindow();
    try {
        await window.loadURL(targetLink);
        await humanDelay();
        await waitForThreadsStep<boolean>(
            window,
            buildClickThreadsMoreScript(targetLink),
            'Could not find the More button on the Threads post',
        );
        await humanDelay();
        await waitForThreadsStep<boolean>(
            window,
            buildClickThreadsDeleteMenuItemScript(),
            'Could not find Delete in the Threads post menu',
        );
        await humanDelay();
        await waitForThreadsStep<boolean>(
            window,
            buildConfirmThreadsDeleteScript(),
            'Could not find the Threads delete confirmation button',
        );
        await humanDelay(700, 1_200);
        return { deleted: true };
    } finally {
        if (!window.isDestroyed()) window.destroy();
    }
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
        const targetLink = replyToLink
            ? normalizeThreadsPostUrl(replyToLink)
            : undefined;
        await window.loadURL(
            targetLink
                ? targetLink
                : `${THREADS_HOME}intent/post?text=${encodeURIComponent(text)}`,
        );
        await humanDelay();
        if (targetLink) {
            await waitForThreadsStep<boolean>(
                window,
                buildClickThreadsReplyScript(targetLink),
                'Could not open the reply composer on the Threads post',
            );
            await humanDelay();
        }
        await waitForThreadsStep<boolean>(
            window,
            `(() => {
                const visible = (candidate) =>
                    candidate.getClientRects().length > 0 &&
                    candidate.getAttribute('aria-hidden') !== 'true';
                const candidates = Array.from(document.querySelectorAll(
                    '[role="dialog"] [contenteditable="true"], ' +
                    '[contenteditable="true"][role="textbox"], ' +
                    '[contenteditable="true"][data-lexical-editor="true"], ' +
                    'textarea'
                ));
                const editor = candidates.find(visible);
                if (!editor) return false;
                editor.focus();
                return true;
            })()`,
            targetLink
                ? 'Could not find the Threads reply editor'
                : 'Could not find the Threads post editor',
        );
        if (targetLink) {
            await humanDelay();
            await window.webContents.executeJavaScript(
                buildSnapshotThreadsComposerButtonsScript(),
                true,
            );
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
        await waitForThreadsStep<boolean>(
            window,
            buildClickThreadsSubmitScript(),
            targetLink
                ? 'Could not find the button that publishes a Threads reply'
                : 'Could not find the button that publishes a Threads post',
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
    } catch (error) {
        if (replyToLink && !window.isDestroyed()) {
            await dumpThreadsDebugSnapshot(window, 'reply-failure');
        }
        throw error;
    } finally {
        watcher?.stop();
        if (!window.isDestroyed()) window.destroy();
    }
}
