const THREADS_HOSTS = new Set([
    'threads.com',
    'www.threads.com',
    'threads.net',
    'www.threads.net',
]);

export function normalizeThreadsPostUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error('Invalid Threads reply link');
    }
    if (
        url.protocol !== 'https:' ||
        !THREADS_HOSTS.has(url.hostname) ||
        !/\/post\/[^/]+/.test(url.pathname)
    ) {
        throw new Error('Invalid Threads reply link');
    }
    return url.href;
}
