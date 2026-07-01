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

function authHeaders(): Record<string, string> {
    return getToken() ? { authorization: `Bearer ${getToken()}` } : {};
}

export async function uploadImage(
    file: File,
): Promise<{ id: string; filename: string; size: number }> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/uploads', {
        method: 'POST',
        headers: authHeaders(),
        body: form,
    });
    if (res.status === 401) {
        clearToken();
        onUnauthorized?.();
        throw new Error('Session expired — please log in again');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error || 'Upload failed');
    return data;
}

/** Fetch an authenticated image as an object URL for previewing. */
export async function fetchImageObjectUrl(id: string): Promise<string> {
    const res = await fetch(`/api/uploads/${id}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Failed to load image');
    return URL.createObjectURL(await res.blob());
}
