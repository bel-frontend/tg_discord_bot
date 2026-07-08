import type { Page } from 'playwright-core';
import type { LoginDetector } from '../../browserSessions';

// A guessed "logged in" marker (e.g. a specific compose-button aria-label) turned out
// to be too fragile — it never matched the real threads.net DOM, so the poll in
// browserSessions/manager.ts never saw a successful login and the connect session
// never closed. Detecting a password field's *absence* is a much more robust signal:
// it holds regardless of exactly how Threads' logged-in UI is marked up, and it also
// naturally covers Meta's post-login interstitials (e.g. "save login info"), which
// have already set valid session cookies even though the main feed hasn't rendered yet.
const LOGIN_URL_PATTERN = /\/(login|accounts\/login)(?:$|[/?])/;
const PASSWORD_INPUT_SELECTOR = 'input[type="password"]';

export const threadsLoginDetector: LoginDetector = {
    async isLoggedIn(page: Page): Promise<boolean> {
        if (LOGIN_URL_PATTERN.test(page.url())) return false;
        return (await page.locator(PASSWORD_INPUT_SELECTOR).count()) === 0;
    },
    async isLoggedOut(page: Page): Promise<boolean> {
        if (LOGIN_URL_PATTERN.test(page.url())) return true;
        return (await page.locator(PASSWORD_INPUT_SELECTOR).count()) > 0;
    },
};
