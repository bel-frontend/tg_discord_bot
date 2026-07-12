import { SignJWT, jwtVerify } from 'jose';
import {
    getPlatformConfigValues,
    upsertPlatformConfig,
} from './platformConfigs';

const PLATFORM_ID = 'threads';
const DEFAULT_AUTH_URL = 'https://threads.net/oauth/authorize';
const DEFAULT_GRAPH_BASE_URL = 'https://graph.threads.net/v1.0';
const STATE_TYPE = 'threads_oauth';

interface GraphResponse {
    access_token?: string;
    id?: string;
    username?: string;
    error_message?: string;
    error?: { message?: string };
}

function graphBaseUrl(): string {
    return (process.env.THREADS_GRAPH_BASE_URL || DEFAULT_GRAPH_BASE_URL).replace(
        /\/$/,
        '',
    );
}

function publicOrigin(requestOrigin: string): string {
    return (process.env.PUBLIC_BASE_URL || requestOrigin).replace(/\/$/, '');
}

function redirectUri(requestOrigin: string): string {
    return `${publicOrigin(requestOrigin)}/api/threads/oauth/callback`;
}

function stateSecret(): Uint8Array {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is required for Threads OAuth');
    return new TextEncoder().encode(secret);
}

async function createState(accountId: string): Promise<string> {
    return new SignJWT({ type: STATE_TYPE })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(accountId)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(stateSecret());
}

async function verifyState(state: string): Promise<string> {
    const { payload } = await jwtVerify(state, stateSecret(), {
        algorithms: ['HS256'],
    });
    if (payload.type !== STATE_TYPE || !payload.sub) {
        throw new Error('Invalid Threads OAuth state');
    }
    return payload.sub;
}

function readGraphError(json: GraphResponse, fallback: string): string {
    return json.error?.message || json.error_message || fallback;
}

async function fetchGraph(
    url: string,
    init: RequestInit,
    fallback: string,
): Promise<GraphResponse> {
    const response = await fetch(url, init);
    const json = (await response.json().catch(() => ({}))) as GraphResponse;
    if (!response.ok || json.error || json.error_message) {
        throw new Error(readGraphError(json, fallback));
    }
    return json;
}

export async function createThreadsOAuthStart(
    accountId: string,
    requestOrigin: string,
): Promise<{ authUrl: string; redirectUri: string }> {
    const values = await getPlatformConfigValues(accountId, PLATFORM_ID);
    if (!values.THREADS_APP_ID || !values.THREADS_APP_SECRET) {
        throw new Error('Save the Threads app id and app secret first');
    }

    const callback = redirectUri(requestOrigin);
    const authUrl = new URL(
        process.env.THREADS_OAUTH_AUTHORIZE_URL || DEFAULT_AUTH_URL,
    );
    authUrl.searchParams.set('client_id', values.THREADS_APP_ID);
    authUrl.searchParams.set('redirect_uri', callback);
    authUrl.searchParams.set('scope', 'threads_basic,threads_content_publish');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', await createState(accountId));
    return { authUrl: authUrl.toString(), redirectUri: callback };
}

export async function completeThreadsOAuth(
    url: URL,
): Promise<{ threadsUserId: string; username?: string }> {
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
        throw new Error(
            url.searchParams.get('error_description') || oauthError,
        );
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) throw new Error('Missing Threads OAuth code or state');

    const accountId = await verifyState(state);
    const values = await getPlatformConfigValues(accountId, PLATFORM_ID);
    const appId = values.THREADS_APP_ID;
    const appSecret = values.THREADS_APP_SECRET;
    if (!appId || !appSecret) {
        throw new Error('Threads app id and app secret are not configured');
    }

    const shortToken = await fetchGraph(
        `${graphBaseUrl()}/oauth/access_token`,
        {
            method: 'POST',
            body: new URLSearchParams({
                client_id: appId,
                client_secret: appSecret,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri(url.origin),
                code,
            }),
        },
        'Failed to exchange the Threads OAuth code',
    );
    if (!shortToken.access_token) {
        throw new Error('Threads OAuth did not return an access token');
    }

    const longTokenUrl = new URL(`${graphBaseUrl()}/access_token`);
    longTokenUrl.searchParams.set('grant_type', 'th_exchange_token');
    longTokenUrl.searchParams.set('client_secret', appSecret);
    longTokenUrl.searchParams.set('access_token', shortToken.access_token);
    const longToken = await fetchGraph(
        longTokenUrl.toString(),
        { method: 'GET' },
        'Failed to create a long-lived Threads token',
    );
    if (!longToken.access_token) {
        throw new Error('Threads OAuth did not return a long-lived token');
    }

    const profileUrl = new URL(`${graphBaseUrl()}/me`);
    profileUrl.searchParams.set('fields', 'id,username');
    profileUrl.searchParams.set('access_token', longToken.access_token);
    const profile = await fetchGraph(
        profileUrl.toString(),
        { method: 'GET' },
        'Failed to read the Threads profile',
    );
    if (!profile.id) throw new Error('Threads did not return a profile id');

    await upsertPlatformConfig(accountId, PLATFORM_ID, {
        THREADS_APP_ID: appId,
        THREADS_APP_SECRET: appSecret,
        THREADS_ACCESS_TOKEN: longToken.access_token,
        THREADS_USER_ID: profile.id,
    });
    return { threadsUserId: profile.id, username: profile.username };
}

export function threadsDataDeletionResponse(origin: string): {
    url: string;
    confirmation_code: string;
} {
    return {
        url: `${publicOrigin(origin)}/settings`,
        confirmation_code: 'threads-data-deletion-received',
    };
}
