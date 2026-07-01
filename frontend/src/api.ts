let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
    onUnauthorized = fn;
}

export const getToken = () => localStorage.getItem('token');
export const setToken = (t: string) => localStorage.setItem('token', t);
export const clearToken = () => localStorage.removeItem('token');

interface ApiOptions {
    method?: string;
    body?: unknown;
}

export async function api<T = any>(
    path: string,
    { method = 'GET', body }: ApiOptions = {},
): Promise<T> {
    const res = await fetch(path, {
        method,
        headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
        clearToken();
        onUnauthorized?.();
        throw new Error('Session expired — please log in again');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error || 'Request failed');
    return data as T;
}
