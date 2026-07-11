// Shared shapes for the browser-session subsystem. Kept out of shared/types.ts
// because none of this crosses the HTTP/JSON boundary as-is — the API only
// ever exposes the small status/handle projections defined in store.ts/index.ts.

export type BrowserSessionPhase =
    | 'launching'
    | 'awaiting_login'
    | 'connected'
    | 'idle'
    | 'closed'
    | 'error';

export interface BrowserSessionHandle {
    sessionId: string;
    accountId: string;
    platform: string;
    phase: BrowserSessionPhase;
    createdAt: Date;
    lastActivityAt: Date;
    error?: string;
}

/**
 * Which cookies mark a real logged-in session for a platform. Used to validate
 * storageState JSON imported from a client-side login (scripts/connect-local.ts)
 * before persisting it.
 */
export interface SessionCookieCheck {
    /** Cookie domain suffixes to accept, e.g. ['threads.com', 'instagram.com']. */
    domainSuffixes: string[];
    /** Session cookie names, e.g. ['sessionid']. */
    names: string[];
}

/** Per-platform predicate: is the live page past login? Polled during `awaiting_login`. */
export interface LoginDetector {
    isLoggedIn(page: import('playwright-core').Page): Promise<boolean>;
    /** True when the page has been kicked back to a login/challenge screen mid-automation. */
    isLoggedOut(page: import('playwright-core').Page): Promise<boolean>;
}

export interface EncryptedBlob {
    ciphertext: string;
    iv: string;
    authTag: string;
}

/** Thrown when there's no persisted session, or the page bounced back to a login screen mid-publish. */
export class ReconnectRequiredError extends Error {}
