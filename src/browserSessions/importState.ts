// Client-side login path: the operator logs in with a Chrome running on their own
// machine (scripts/connect-local.ts) and uploads the resulting Playwright storageState
// here. This sidesteps the server-side headed connect flow, which needs an X server
// (Xvfb) that not every deploy has. Downstream (acquireAutomationContext, publish)
// consumes the same persisted JSON either way.

import type { SessionCookieCheck } from './types';
import { evictIdleAutomationContext, getBrowserPlatformConfig } from './manager';
import { upsertBrowserSessionState } from './store';

export class InvalidSessionStateError extends Error {}

interface StorageStateCookie {
    name: string;
    value: string;
    domain: string;
    /** Unix seconds; -1 for session cookies (Playwright convention). */
    expires?: number;
}

export interface StorageStateShape {
    cookies: StorageStateCookie[];
    origins: unknown[];
}

function isCookie(value: unknown): value is StorageStateCookie {
    if (!value || typeof value !== 'object') return false;
    const cookie = value as Record<string, unknown>;
    return (
        typeof cookie.name === 'string' &&
        typeof cookie.value === 'string' &&
        typeof cookie.domain === 'string'
    );
}

function matchesDomain(cookieDomain: string, suffix: string): boolean {
    return cookieDomain === suffix || cookieDomain.endsWith(`.${suffix}`);
}

function isSessionCookiePresent(
    cookies: StorageStateCookie[],
    check: SessionCookieCheck,
): boolean {
    const nowSeconds = Date.now() / 1000;
    return cookies.some(
        (cookie) =>
            check.names.includes(cookie.name) &&
            cookie.value !== '' &&
            check.domainSuffixes.some((suffix) => matchesDomain(cookie.domain, suffix)) &&
            (typeof cookie.expires !== 'number' ||
                cookie.expires <= 0 ||
                cookie.expires > nowSeconds),
    );
}

export function validateStorageState(
    raw: unknown,
    check?: SessionCookieCheck,
): StorageStateShape {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new InvalidSessionStateError(
            'storageState must be an object with "cookies" and "origins"',
        );
    }
    const state = raw as Record<string, unknown>;
    if (!Array.isArray(state.cookies) || !state.cookies.every(isCookie)) {
        throw new InvalidSessionStateError(
            'storageState.cookies must be an array of { name, value, domain } cookies',
        );
    }
    if (!Array.isArray(state.origins)) {
        throw new InvalidSessionStateError('storageState.origins must be an array');
    }
    if (check && !isSessionCookiePresent(state.cookies, check)) {
        throw new InvalidSessionStateError(
            `No valid session cookie (${check.names.join(', ')}) found — ` +
                'finish logging in before importing the session',
        );
    }
    return { cookies: state.cookies, origins: state.origins };
}

/** Validates and persists a storageState captured by a client-side login. */
export async function importBrowserSessionState(
    accountId: string,
    platform: string,
    raw: unknown,
): Promise<void> {
    const config = getBrowserPlatformConfig(platform);
    if (!config) {
        throw new InvalidSessionStateError(
            `No browser-session config registered for platform "${platform}"`,
        );
    }
    const state = validateStorageState(raw, config.sessionCookies);
    await upsertBrowserSessionState(accountId, platform, JSON.stringify(state));
    // Same reasoning as the hosted reconnect path in manager.ts's pollLogin: a stale
    // warm context must not survive a fresh session import.
    await evictIdleAutomationContext(accountId, platform);
}
