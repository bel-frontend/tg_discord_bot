import type { Page } from 'playwright-core';
import {
    acquireAutomationContext,
    markPublished,
    markReconnectRequired,
    ReconnectRequiredError,
} from '../browserSessions';

export { ReconnectRequiredError };

const operationQueues = new Map<string, Promise<void>>();
const lastOperationFinishedAt = new Map<string, number>();

function envNumber(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCooldown(key: string): Promise<void> {
    const cooldown = envNumber('BROWSER_PLATFORM_OPERATION_COOLDOWN_MS', 0);
    if (cooldown <= 0) return;

    const finishedAt = lastOperationFinishedAt.get(key);
    if (!finishedAt) return;

    const remaining = cooldown - (Date.now() - finishedAt);
    if (remaining > 0) await sleep(remaining);
}

async function runQueued<T>(
    key: string,
    fn: () => Promise<T>,
): Promise<T> {
    const previous = operationQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const next = previous.then(() => current, () => current);
    operationQueues.set(key, next);

    await previous.catch(() => {});
    try {
        await waitForCooldown(key);
        return await fn();
    } finally {
        lastOperationFinishedAt.set(key, Date.now());
        release();
        if (operationQueues.get(key) === next) {
            operationQueues.delete(key);
        }
    }
}

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
    options: { markPublishedOnSuccess?: boolean } = {},
): Promise<T> {
    const key = `${accountId}:${platform}`;
    return runQueued(key, async () => {
        const { page, release } = await acquireAutomationContext(accountId, platform);
        try {
            const result = await fn(page);
            if (options.markPublishedOnSuccess !== false) {
                await markPublished(accountId, platform);
            }
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
    });
}
