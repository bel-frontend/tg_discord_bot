import { AuthError, requireAuth, type ActorContext } from './auth';
import { assertPermission } from './permissions';
import {
    completeThreadsOAuth,
    createThreadsOAuthStart,
    threadsDataDeletionResponse,
} from './threadsOAuth';
import {
    attachLiveView,
    closeSession,
    detachLiveView,
    disconnectPlatform,
    getBrowserSessionStatus,
    getSession,
    handleClientFrame,
    importBrowserSessionState,
    startConnectSession,
    type ClientFrame,
} from './browserSessions';
import { empty, escapeHtml, html, json } from './httpResponses';

export interface LiveViewSocketData {
    sessionId: string;
}

export const liveViewMatch = /^\/api\/browser-sessions\/([^/]+)\/live$/;

export async function handlePublicPlatformConnectionRoute(
    req: Request,
    url: URL,
): Promise<Response | undefined> {
    const path = url.pathname;
    const method = req.method;
    const threadsPublicPaths = new Set([
        '/api/threads/oauth/callback',
        '/api/threads/deauthorize',
        '/api/threads/data-deletion',
    ]);
    if (method === 'HEAD' && threadsPublicPaths.has(path)) return empty();

    if (path === '/api/threads/oauth/callback' && method === 'GET') {
        try {
            const profile = await completeThreadsOAuth(url);
            const label = profile.username || profile.threadsUserId;
            return html(
                '<!doctype html><meta charset="utf-8">' +
                    '<title>Threads connected</title>' +
                    '<body style="font-family:sans-serif;padding:40px;' +
                    'max-width:640px;margin:auto">' +
                    '<h1>Threads connected</h1>' +
                    `<p>Connected profile: <strong>${escapeHtml(label)}</strong>.</p>` +
                    '<p><a href="/settings?platform=threads">Return to settings</a></p>' +
                    '</body>',
            );
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : 'Threads OAuth failed';
            return html(
                '<!doctype html><meta charset="utf-8">' +
                    '<title>Threads connection failed</title>' +
                    '<body style="font-family:sans-serif;padding:40px;' +
                    'max-width:640px;margin:auto">' +
                    '<h1>Threads connection failed</h1>' +
                    `<p>${escapeHtml(message)}</p>` +
                    '<p><a href="/settings?platform=threads">Return to settings</a></p>' +
                    '</body>',
                400,
            );
        }
    }

    if (path === '/api/threads/deauthorize' && method === 'POST') {
        return json({ ok: true });
    }
    if (path === '/api/threads/data-deletion' && method === 'POST') {
        return json(threadsDataDeletionResponse(url.origin));
    }
    return undefined;
}

export async function handleAuthenticatedPlatformConnectionRoute(
    actor: ActorContext,
    req: Request,
    url: URL,
): Promise<Response | undefined> {
    const path = url.pathname;
    const method = req.method;

    const oauthStartMatch = path.match(
        /^\/api\/platform-connections\/([^/]+)\/oauth\/start$/,
    );
    if (oauthStartMatch && method === 'POST') {
        try {
            assertPermission(actor, 'canManageChannels');
            if (oauthStartMatch[1] !== 'threads') {
                return json({ error: 'OAuth is not supported for this platform' }, 400);
            }
            return json(
                await createThreadsOAuthStart(actor.accountId, url.origin),
            );
        } catch (error: unknown) {
            if (error instanceof AuthError) {
                return json({ error: error.message }, error.status);
            }
            return json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Failed to start Threads OAuth',
                },
                400,
            );
        }
    }

    const browserSessionStartMatch = path.match(
        /^\/api\/browser-sessions\/([^/]+)\/start$/,
    );
    if (browserSessionStartMatch && method === 'POST') {
        try {
            assertPermission(actor, 'canManageChannels');
            const handle = await startConnectSession(
                actor.accountId,
                browserSessionStartMatch[1],
            );
            return json({
                sessionId: handle.sessionId,
                wsUrl: `/api/browser-sessions/${handle.sessionId}/live`,
            });
        } catch (err: unknown) {
            if (err instanceof AuthError) {
                return json({ error: err.message }, err.status);
            }
            return json(
                {
                    error:
                        err instanceof Error
                            ? err.message
                            : 'Failed to start browser session',
                },
                400,
            );
        }
    }

    // Client-side login: scripts/connect-local.ts logs in with the operator's local
    // Chrome and uploads the captured Playwright storageState here.
    const browserSessionImportMatch = path.match(
        /^\/api\/browser-sessions\/([^/]+)\/import$/,
    );
    if (browserSessionImportMatch && method === 'POST') {
        try {
            assertPermission(actor, 'canManageChannels');
            const body = (await req.json().catch(() => null)) as {
                storageState?: unknown;
            } | null;
            if (!body || typeof body !== 'object') {
                return json({ error: 'Request body must be {"storageState": …}' }, 400);
            }
            await importBrowserSessionState(
                actor.accountId,
                browserSessionImportMatch[1],
                body.storageState,
            );
            return json({ ok: true, status: 'connected' });
        } catch (err: unknown) {
            if (err instanceof AuthError) {
                return json({ error: err.message }, err.status);
            }
            return json(
                {
                    error:
                        err instanceof Error
                            ? err.message
                            : 'Failed to import session',
                },
                400,
            );
        }
    }

    const browserSessionStatusMatch = path.match(
        /^\/api\/browser-sessions\/([^/]+)\/status$/,
    );
    if (browserSessionStatusMatch && method === 'GET') {
        const status = await getBrowserSessionStatus(
            actor.accountId,
            browserSessionStatusMatch[1],
        );
        return json({
            connected: status?.status === 'connected',
            status: status?.status ?? 'not_connected',
            lastVerifiedAt: status?.lastVerifiedAt?.toISOString(),
        });
    }

    const browserSessionCloseMatch = path.match(
        /^\/api\/browser-sessions\/([^/]+)\/close$/,
    );
    if (browserSessionCloseMatch && method === 'POST') {
        const sessionId = browserSessionCloseMatch[1];
        const session = getSession(sessionId);
        if (session && session.accountId !== actor.accountId) {
            return json({ error: 'Not found' }, 404);
        }
        await closeSession(sessionId);
        return json({ ok: true });
    }

    const browserSessionDisconnectMatch = path.match(
        /^\/api\/browser-sessions\/([^/]+)\/disconnect$/,
    );
    if (browserSessionDisconnectMatch && method === 'DELETE') {
        try {
            assertPermission(actor, 'canManageChannels');
            await disconnectPlatform(
                actor.accountId,
                browserSessionDisconnectMatch[1],
            );
            return json({ ok: true });
        } catch (err: unknown) {
            if (err instanceof AuthError) {
                return json({ error: err.message }, err.status);
            }
            return json(
                {
                    error:
                        err instanceof Error
                            ? err.message
                            : 'Failed to disconnect',
                },
                400,
            );
        }
    }

    return undefined;
}

// WebSocket handshakes can't set an Authorization header, so the token rides in
// the query string.
export async function handleLiveViewUpgrade(
    req: Request,
    server: Bun.Server,
    sessionId: string,
): Promise<Response | undefined> {
    const url = new URL(req.url);
    let actor;
    try {
        actor = await requireAuth(req, {
            tokenOverride: url.searchParams.get('token') || '',
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) {
            return json({ error: error.message }, error.status);
        }
        return json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : 'Authentication required',
            },
            401,
        );
    }

    const session = getSession(sessionId);
    if (!session || session.accountId !== actor.accountId) {
        return json({ error: 'Not found' }, 404);
    }

    const upgraded = server.upgrade<LiveViewSocketData>(req, {
        data: { sessionId },
    });
    if (upgraded) return undefined;
    return json({ error: 'Upgrade failed' }, 400);
}

export function attachPlatformLiveView(
    ws: Bun.ServerWebSocket<LiveViewSocketData>,
): void {
    const { sessionId } = ws.data;
    attachLiveView(sessionId, {
        send: (frame) => ws.send(JSON.stringify(frame)),
        close: () => ws.close(),
    }).catch((error) => {
        console.error(
            `Failed to attach live view for session ${sessionId}:`,
            error,
        );
        ws.close();
    });
}

export function handlePlatformLiveViewMessage(
    ws: Bun.ServerWebSocket<LiveViewSocketData>,
    message: string | Buffer,
): void {
    try {
        const frame = JSON.parse(String(message)) as ClientFrame;
        handleClientFrame(ws.data.sessionId, frame);
    } catch {
        // Ignore malformed client frames rather than tearing down the socket.
    }
}

export function detachPlatformLiveView(
    ws: Bun.ServerWebSocket<LiveViewSocketData>,
): void {
    detachLiveView(ws.data.sessionId);
}
