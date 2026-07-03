import type {
    Publication,
    PlatformMeta,
    PlatformConfigStatus,
    ScheduledPublication,
} from '../../shared/types';

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

export async function validatePost(
    markdown: string,
    platforms: string[],
): Promise<{
    ok: boolean;
    issues: Array<{
        platform: string;
        chunk: number;
        message: string;
        tag?: string;
        offset?: number;
        line?: number;
        excerpt?: string;
        htmlContext?: string;
    }>;
}> {
    return api('/api/validate', {
        method: 'POST',
        body: { markdown, platforms },
    });
}

export async function fetchPreview(
    markdown: string,
): Promise<Record<string, string>> {
    return api('/api/preview', {
        method: 'POST',
        body: { markdown },
    });
}

export async function fetchPlatforms(): Promise<PlatformMeta[]> {
    const { platforms } = await api<{ platforms: PlatformMeta[] }>(
        '/api/platforms',
    );
    return platforms;
}

export async function fetchPlatformConfigs(): Promise<PlatformConfigStatus[]> {
    const { configs } = await api<{ configs: PlatformConfigStatus[] }>(
        '/api/platform-configs',
    );
    return configs;
}

export async function savePlatformConfig(
    platform: string,
    values: Record<string, string>,
): Promise<PlatformConfigStatus> {
    const { config } = await api<{ config: PlatformConfigStatus }>(
        `/api/platform-configs/${platform}`,
        {
            method: 'PUT',
            body: values,
        },
    );
    return config;
}

/** Remove a single saved credential field (e.g. a token) without touching the others. */
export async function clearPlatformConfigField(
    platform: string,
    fieldName: string,
): Promise<PlatformConfigStatus> {
    const { config } = await api<{ config: PlatformConfigStatus }>(
        `/api/platform-configs/${platform}`,
        {
            method: 'PUT',
            body: { clearFields: [fieldName] },
        },
    );
    return config;
}

export async function startThreadsOAuth(): Promise<{
    authUrl: string;
    redirectUri: string;
}> {
    return api('/api/threads/oauth/start', { method: 'POST' });
}

export async function fetchScheduledPublications(): Promise<
    ScheduledPublication[]
> {
    const { scheduledPublications } = await api<{
        scheduledPublications: ScheduledPublication[];
    }>('/api/scheduled-publications');
    return scheduledPublications;
}

export async function fetchPublications(draftId?: string): Promise<
    Publication[]
> {
    const query = draftId ? `?draftId=${encodeURIComponent(draftId)}` : '';
    const { publications } = await api<{ publications: Publication[] }>(
        `/api/publications${query}`,
    );
    return publications;
}

export async function fetchPublication(id: string): Promise<Publication> {
    const { publication } = await api<{ publication: Publication }>(
        `/api/publications/${encodeURIComponent(id)}`,
    );
    return publication;
}

export async function deletePublication(id: string): Promise<{
    results: Array<{ ok: boolean }>;
    deleted: boolean;
}> {
    return api(`/api/publications/${encodeURIComponent(id)}/delete`, {
        method: 'POST',
    });
}

export async function schedulePublication(
    draftId: string,
    scheduledAt: string,
): Promise<ScheduledPublication> {
    const { scheduledPublication } = await api<{
        scheduledPublication: ScheduledPublication;
    }>('/api/scheduled-publications', {
        method: 'POST',
        body: { draftId, scheduledAt },
    });
    return scheduledPublication;
}

export async function cancelScheduledPublication(
    id: string,
): Promise<ScheduledPublication> {
    const { scheduledPublication } = await api<{
        scheduledPublication: ScheduledPublication;
    }>(`/api/scheduled-publications/${id}`, {
        method: 'DELETE',
    });
    return scheduledPublication;
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
