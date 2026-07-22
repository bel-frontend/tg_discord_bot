import {
    BrowserPublisherSession,
    humanDelay,
    waitForJavaScript,
} from '../../browserPublisherSession';
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

        const link = await waitForJavaScript<string>(
            window,
            `(() => {
                const known = new Set(${JSON.stringify([...knownLinks])});
                return Array.from(document.querySelectorAll('a[href*="/post/"]'))
                    .map((item) => item.href)
                    .find((href) => !known.has(href)) || null;
            })()`,
            45_000,
        );
        const messageId = link.match(/\/post\/([^/?]+)/)?.[1];
        if (!messageId) throw new Error('Could not identify the Threads post');
        return { messageId, link };
    } finally {
        if (!window.isDestroyed()) window.destroy();
    }
}
