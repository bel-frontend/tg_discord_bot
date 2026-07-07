import type { Page } from 'playwright-core';
import type { LoginDetector } from '../../browserSessions';

// The compose button only renders once logged in, and its presence is more reliable
// than a URL check alone (x.com bounces through several intermediate redirects during login).
const COMPOSE_BUTTON_SELECTOR = '[data-testid="SideNav_NewTweet_Button"]';
const LOGIN_URL_PATTERN = /\/(login|i\/flow\/login|logout)(?:$|[/?])/;

export const xLoginDetector: LoginDetector = {
    async isLoggedIn(page: Page): Promise<boolean> {
        if (LOGIN_URL_PATTERN.test(page.url())) return false;
        return (await page.locator(COMPOSE_BUTTON_SELECTOR).count()) > 0;
    },
    async isLoggedOut(page: Page): Promise<boolean> {
        if (LOGIN_URL_PATTERN.test(page.url())) return true;
        return (await page.locator(COMPOSE_BUTTON_SELECTOR).count()) === 0;
    },
};
