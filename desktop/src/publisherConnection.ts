export async function applyPublisherConnectionChange<T>(
    change: () => Promise<void>,
    heartbeat: () => Promise<void>,
    getStatus: () => Promise<T>,
): Promise<T> {
    await change();
    await heartbeat();
    return getStatus();
}
