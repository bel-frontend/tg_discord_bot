import type { Page } from 'playwright-core';
import {
    acquireAutomationContext,
    markPublished,
    markReconnectRequired,
    ReconnectRequiredError,
} from '../browserSessions';

export { ReconnectRequiredError };

/**
 * Wraps acquireAutomationContext/release plus the "session missing" / "logged out mid-publish"
 * -> ReconnectRequiredError mapping, so a browser-driven platform's publish() body only has to
 * describe DOM steps, not session plumbing. Shared as a helper (not a base class) so adapters
 * stay independent of each other, per the "new platform module must not depend on another
 * platform module's internals" rule — this only depends on the browserSessions subsystem.
 */
export async function withAutomationPage<T>(
    accountId: string,
    platform: string,
    isLoggedOut: (page: Page) => Promise<boolean>,
    fn: (page: Page) => Promise<T>,
): Promise<T> {
    const { page, release } = await acquireAutomationContext(accountId, platform);
    try {
        const result = await fn(page);
        await markPublished(accountId, platform);
        return result;
    } catch (error) {
        if (error instanceof ReconnectRequiredError) throw error;
        if (await isLoggedOut(page).catch(() => false)) {
            await markReconnectRequired(accountId, platform);
            throw new ReconnectRequiredError(
                `${platform} session expired — reconnect in Settings`,
            );
        }
        throw error;
    } finally {
        await release();
    }
}
