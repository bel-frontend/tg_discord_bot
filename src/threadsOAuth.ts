import { SignJWT, jwtVerify } from 'jose';
import {
    getPlatformConfigValues,
    upsertPlatformConfig,
} from './platformConfigs';

const THREADS_PLATFORM_ID = 'threads';
const DEFAULT_AUTH_URL = 'https://threads.net/oauth/authorize';
const DEFAULT_GRAPH_BASE_URL = 'https://graph.threads.net/v1.0';
const STATE_EXPIRY = '10m';
const STATE_TYPE = 'threads_oauth';
const STATE_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || 'change-me-in-production',
);

interface ThreadsTokenResponse {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error_message?: string;
    error?: {
        message?: string;
    };
}

interface ThreadsMeResponse {
    id?: string;
    username?: string;
    error?: {
        message?: string;
    };
}

function graphBaseUrl(): string {
    return (process.env.THREADS_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL).replace(
        /\/$/,
        '',
    );
}

function oauthRedirectUri(origin: string): string {
    return `${origin.replace(/\/$/, '')}/api/threads/oauth/callback`;
}

function oauthAuthUrl(): string {
    return process.env.THREADS_OAUTH_AUTHORIZE_URL || DEFAULT_AUTH_URL;
}

function readError(json: ThreadsTokenResponse | ThreadsMeResponse): string {
    const errorMessage =
        'error_message' in json ? json.error_message : undefined;
    return json.error?.message || errorMessage || 'Threads OAuth failed';
}

async function createState(userId: string): Promise<string> {
    return new SignJWT({ type: STATE_TYPE })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(STATE_EXPIRY)
        .sign(STATE_SECRET);
}

async function verifyState(state: string): Promise<string> {
    const { payload } = await jwtVerify(state, STATE_SECRET, {
        algorithms: ['HS256'],
    });
    if (payload.type !== STATE_TYPE || !payload.sub) {
        throw new Error('Invalid Threads OAuth state');
    }
    return payload.sub;
}

async function fetchJson<T>(
    url: string,
    init: RequestInit,
    fallback: string,
): Promise<T> {
    const response = await fetch(url, init);
    const json = (await response.json().catch(() => ({}))) as T &
        ThreadsTokenResponse;
    if (!response.ok || json.error || json.error_message) {
        const message = readError(json);
        throw new Error(message === 'Threads OAuth failed' ? fallback : message);
    }
    return json;
}

export async function createThreadsOAuthStart(
    userId: string,
    origin: string,
): Promise<{ authUrl: string; redirectUri: string }> {
    const values = await getPlatformConfigValues(userId, THREADS_PLATFORM_ID);
    const appId = values.THREADS_APP_ID || '';
    const appSecret = values.THREADS_APP_SECRET || '';
    if (!appId || !appSecret) {
        throw new Error('Threads app id and app secret are required first');
    }

    const redirectUri = oauthRedirectUri(origin);
    const authUrl = new URL(oauthAuthUrl());
    authUrl.searchParams.set('client_id', appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'threads_basic,threads_content_publish');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', await createState(userId));

    return { authUrl: authUrl.toString(), redirectUri };
}

export async function completeThreadsOAuth(
    url: URL,
): Promise<{ userId: string; threadsUserId: string; username?: string }> {
    const error = url.searchParams.get('error');
    if (error) {
        throw new Error(url.searchParams.get('error_description') || error);
    }

    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    if (!code || !state) throw new Error('Missing Threads OAuth code or state');

    const userId = await verifyState(state);
    const values = await getPlatformConfigValues(userId, THREADS_PLATFORM_ID);
    const appId = values.THREADS_APP_ID || '';
    const appSecret = values.THREADS_APP_SECRET || '';
    if (!appId || !appSecret) {
        throw new Error('Threads app id and app secret are not configured');
    }

    const shortToken = await fetchJson<ThreadsTokenResponse>(
        `${graphBaseUrl()}/oauth/access_token`,
        {
            method: 'POST',
            body: new URLSearchParams({
                client_id: appId,
                client_secret: appSecret,
                grant_type: 'authorization_code',
                redirect_uri: oauthRedirectUri(url.origin),
                code,
            }),
        },
        'Failed to exchange Threads OAuth code',
    );
    if (!shortToken.access_token) {
        throw new Error('Threads OAuth did not return an access token');
    }

    const longTokenUrl = new URL(`${graphBaseUrl()}/access_token`);
    longTokenUrl.searchParams.set('grant_type', 'th_exchange_token');
    longTokenUrl.searchParams.set('client_secret', appSecret);
    longTokenUrl.searchParams.set('access_token', shortToken.access_token);
    const longToken = await fetchJson<ThreadsTokenResponse>(
        longTokenUrl.toString(),
        { method: 'GET' },
        'Failed to create long-lived Threads access token',
    );
    if (!longToken.access_token) {
        throw new Error('Threads OAuth did not return a long-lived token');
    }

    const meUrl = new URL(`${graphBaseUrl()}/me`);
    meUrl.searchParams.set('fields', 'id,username');
    meUrl.searchParams.set('access_token', longToken.access_token);
    const profile = await fetchJson<ThreadsMeResponse>(
        meUrl.toString(),
        { method: 'GET' },
        'Failed to read Threads profile',
    );
    if (!profile.id) throw new Error('Threads profile id was not returned');

    await upsertPlatformConfig(userId, THREADS_PLATFORM_ID, {
        ...values,
        THREADS_APP_ID: appId,
        THREADS_APP_SECRET: appSecret,
        THREADS_ACCESS_TOKEN: longToken.access_token,
        THREADS_USER_ID: profile.id,
    });

    return {
        userId,
        threadsUserId: profile.id,
        username: profile.username,
    };
}

export function threadsDataDeletionResponse(origin: string): {
    url: string;
    confirmation_code: string;
} {
    return {
        url: `${origin.replace(/\/$/, '')}/settings`,
        confirmation_code: 'threads-data-deletion-received',
    };
}
