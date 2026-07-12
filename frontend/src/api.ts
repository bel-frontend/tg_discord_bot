import type {
    Publication,
    PlatformMeta,
    PlatformConfigStatus,
    ScheduledPublication,
    Me,
    MemberPermissions,
    MemberSummary,
    User,
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
    handleUnauthorized?: boolean;
}

export async function api<T = any>(
    path: string,
    { method = 'GET', body, handleUnauthorized = true }: ApiOptions = {},
): Promise<T> {
    const res = await fetch(path, {
        method,
        headers: {
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401 && handleUnauthorized) {
        clearToken();
        onUnauthorized?.();
        throw new Error('Session expired — please log in again');
    }

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

export async function createLocalPublisherPairing(): Promise<{
    code: string;
    expiresAt: string;
}> {
    return api('/api/local-publishers/pairing', { method: 'POST' });
}

export async function startBrowserSession(
    platform: string,
): Promise<{ sessionId: string; wsUrl: string }> {
    return api(`/api/browser-sessions/${platform}/start`, { method: 'POST' });
}

export async function getBrowserSessionStatus(platform: string): Promise<{
    connected: boolean;
    status: 'connected' | 'reconnect_required' | 'not_connected';
    lastVerifiedAt?: string;
}> {
    return api(`/api/browser-sessions/${platform}/status`);
}

export async function closeBrowserSession(sessionId: string): Promise<{ ok: true }> {
    return api(`/api/browser-sessions/${sessionId}/close`, { method: 'POST' });
}

export async function disconnectBrowserSession(
    platform: string,
): Promise<{ ok: true }> {
    return api(`/api/browser-sessions/${platform}/disconnect`, {
        method: 'DELETE',
    });
}

/** Builds the live-view WebSocket URL for a started browser session, token in the query string. */
export function browserSessionLiveViewUrl(wsUrl: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getToken() ?? '';
    return `${protocol}//${window.location.host}${wsUrl}?token=${encodeURIComponent(token)}`;
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

export async function fetchMe(): Promise<Me> {
    return api<Me>('/api/me');
}

export async function resendVerificationEmail(): Promise<{ ok: true }> {
    return api('/api/auth/resend-verification', { method: 'POST' });
}

export async function verifyEmail(
    token: string,
): Promise<{ ok: true; email: string }> {
    return api(`/api/auth/verify-email/${encodeURIComponent(token)}`, {
        method: 'POST',
    });
}

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
    return api('/api/auth/request-password-reset', {
        method: 'POST',
        body: { email },
    });
}

export async function resetPassword(
    token: string,
    password: string,
): Promise<{ token: string; user: User }> {
    return api(`/api/auth/reset-password/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: { password },
    });
}

export async function changePassword(
    currentPassword: string,
    newPassword: string,
): Promise<{ ok: true }> {
    return api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
    });
}

export async function requestEmailChange(
    newEmail: string,
    password: string,
): Promise<{ ok: true }> {
    return api('/api/auth/request-email-change', {
        method: 'POST',
        body: { newEmail, password },
    });
}

export async function confirmEmailChange(
    token: string,
): Promise<{ ok: true; email: string }> {
    return api(`/api/auth/confirm-email-change/${encodeURIComponent(token)}`, {
        method: 'POST',
    });
}

export async function fetchInvite(token: string): Promise<{
    invite: {
        email: string;
        accountOwnerEmail: string;
        requiresPassword: boolean;
    };
}> {
    return api(`/api/invites/${encodeURIComponent(token)}`);
}

export async function acceptInvite(
    token: string,
    password: string,
): Promise<{ token: string; user: { id: string; email: string } }> {
    return api(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: { password },
    });
}

export async function fetchMembers(): Promise<MemberSummary[]> {
    const { members } = await api<{ members: MemberSummary[] }>(
        '/api/members',
    );
    return members;
}

export async function inviteMember(
    email: string,
    permissions: MemberPermissions,
): Promise<MemberSummary> {
    const { member } = await api<{ member: MemberSummary }>(
        '/api/members/invite',
        { method: 'POST', body: { email, permissions } },
    );
    return member;
}

export async function updateMember(
    id: string,
    permissions: MemberPermissions,
): Promise<MemberSummary> {
    const { member } = await api<{ member: MemberSummary }>(
        `/api/members/${encodeURIComponent(id)}`,
        { method: 'PUT', body: { permissions } },
    );
    return member;
}

export async function revokeMember(id: string): Promise<{ ok: true }> {
    return api(`/api/members/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}

export async function resendMemberInvite(id: string): Promise<MemberSummary> {
    const { member } = await api<{ member: MemberSummary }>(
        `/api/members/${encodeURIComponent(id)}/resend`,
        { method: 'POST' },
    );
    return member;
}
