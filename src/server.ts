import { join, normalize } from 'path';
import { AuthError, loginUser, registerUser, requireAuth } from './auth';
import { verifyEmailToken, resendVerification } from './emailVerification';
import {
    acceptInvite,
    createInvite,
    getInvitePreview,
    listMembers,
    resendInvite,
    revokeMember,
    sanitizePermissionsInput,
    updateMemberPermissions,
} from './invites';
import { assertChannelAccess, assertPermission } from './permissions';
import { users } from './db';
import { ObjectId } from 'mongodb';
import {
    listAllChannels,
    listPlatforms,
    listPlatformsMeta,
} from './platforms/registry';
import {
    createDraft,
    deleteDraft,
    getDraft,
    listDrafts,
    updateDraft,
} from './drafts';
import {
    createChannelResource,
    deleteChannelResource,
    listChannelResources,
    updateChannelResource,
} from './channelResources';
import {
    listPlatformConfigs,
    upsertPlatformConfig,
} from './platformConfigs';
import { getUpload, saveUpload } from './uploads';
import { validateMarkdown, previewContent } from './validation';
import { parsePublishRequest, executePublish } from './publishRequest';
import {
    deletePublishedTargets,
    deletePublicationsForDraft,
    getPublication,
    listPublications,
    updatePublishedTargets,
} from './publications';
import {
    cancelScheduledPublication,
    createScheduledPublication,
    deleteScheduledPublicationsForDraft,
    listScheduledPublications,
} from './scheduledPublications';
import {
    completeThreadsOAuth,
    createThreadsOAuthStart,
    threadsDataDeletionResponse,
} from './threadsOAuth';

// The Next static export is copied here by frontend/scripts/copy-static-export.ts.
const PUBLIC_DIR = join(import.meta.dir, '..', 'public');
const NOT_BUILT_HTML =
    '<!doctype html><meta charset="utf-8"><title>Composer</title>' +
    '<body style="font-family:sans-serif;padding:40px;max-width:640px;margin:auto">' +
    '<h1>Frontend not built</h1><p>Run <code>bun run build</code> (or start the Next.js dev ' +
    'server with <code>cd frontend &amp;&amp; bun run dev</code>) to build the UI into ' +
    '<code>public/</code>.</p></body>';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function html(body: string, status = 200): Response {
    return new Response(body, {
        status,
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}

function empty(status = 200): Response {
    return new Response(null, { status });
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function serveStatic(pathname: string): Promise<Response> {
    // Prevent path traversal; default to index.html for the SPA/static export.
    const rel = pathname === '/' ? '/index.html' : pathname;
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const candidates = safe.endsWith('/')
        ? [join(safe, 'index.html')]
        : [join(safe, 'index.html'), safe];

    for (const candidate of candidates) {
        const file = Bun.file(join(PUBLIC_DIR, candidate));
        if (await file.exists()) {
            return new Response(file);
        }
    }
    // SPA fallback
    const index = Bun.file(join(PUBLIC_DIR, 'index.html'));
    if (await index.exists()) {
        return new Response(index, {
            headers: { 'content-type': 'text/html' },
        });
    }
    return new Response(NOT_BUILT_HTML, {
        status: 200,
        headers: { 'content-type': 'text/html' },
    });
}

/** Maps "platform:channelId" -> channelResource id, for assertChannelAccess. */
async function buildResourceIdMap(accountId: string): Promise<Map<string, string>> {
    const resources = await listChannelResources(accountId);
    return new Map(
        resources.map((r) => [`${r.platform}:${r.channelId}`, r.resourceId]),
    );
}

export async function handleApi(req: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    const method = req.method;

    // --- Public auth routes ---
    if (path === '/api/auth/register' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const result = await registerUser(body.email, body.password);
        return json(result, 201);
    }
    if (path === '/api/auth/login' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const result = await loginUser(body.email, body.password);
        return json(result);
    }

    const verifyEmailMatch = path.match(/^\/api\/auth\/verify-email\/([^/]+)$/);
    if (verifyEmailMatch && method === 'POST') {
        try {
            const result = await verifyEmailToken(verifyEmailMatch[1]);
            return json({ ok: true, email: result.email });
        } catch (err: any) {
            return json({ error: err?.message || 'Verification failed' }, 400);
        }
    }

    const invitePreviewMatch = path.match(/^\/api\/invites\/([^/]+)$/);
    if (invitePreviewMatch && method === 'GET') {
        const preview = await getInvitePreview(invitePreviewMatch[1]);
        return json({ invite: preview });
    }

    const inviteAcceptMatch = path.match(/^\/api\/invites\/([^/]+)\/accept$/);
    if (inviteAcceptMatch && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const result = await acceptInvite(inviteAcceptMatch[1], body.password);
        return json(result);
    }

    if (
        method === 'HEAD' &&
        (path === '/api/threads/oauth/callback' ||
            path === '/api/threads/deauthorize' ||
            path === '/api/threads/data-deletion')
    ) {
        return empty();
    }

    if (path === '/api/threads/oauth/callback' && method === 'GET') {
        try {
            const result = await completeThreadsOAuth(url);
            const label = result.username || result.threadsUserId;
            return html(
                '<!doctype html><meta charset="utf-8">' +
                    '<title>Threads connected</title>' +
                    '<body style="font-family:sans-serif;padding:40px;max-width:640px;margin:auto">' +
                    '<h1>Threads connected</h1>' +
                    `<p>Connected Threads profile: <strong>${escapeHtml(label)}</strong>.</p>` +
                    '<p><a href="/settings">Return to settings</a></p>' +
                    '</body>',
            );
        } catch (err: any) {
            return html(
                '<!doctype html><meta charset="utf-8">' +
                    '<title>Threads connection failed</title>' +
                    '<body style="font-family:sans-serif;padding:40px;max-width:640px;margin:auto">' +
                    '<h1>Threads connection failed</h1>' +
                    `<p>${escapeHtml(err?.message || 'OAuth failed')}</p>` +
                    '<p><a href="/settings">Return to settings</a></p>' +
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

    // --- Everything below requires authentication ---
    const actor = await requireAuth(req);

    if (path === '/api/me' && method === 'GET') {
        const selfDoc = ObjectId.isValid(actor.userId)
            ? await users().findOne({ _id: new ObjectId(actor.userId) })
            : null;
        return json({
            user: { id: actor.userId, email: actor.email },
            accountId: actor.accountId,
            role: actor.role,
            permissions: actor.permissions,
            emailVerified: selfDoc?.emailVerified ?? false,
        });
    }

    if (path === '/api/auth/resend-verification' && method === 'POST') {
        try {
            await resendVerification(actor.userId);
            return json({ ok: true });
        } catch (err: any) {
            return json({ error: err?.message || 'Failed to resend' }, 400);
        }
    }

    // --- Members / invites ---
    if (path === '/api/members' && method === 'GET') {
        try {
            return json({ members: await listMembers(actor) });
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            throw err;
        }
    }

    if (path === '/api/members/invite' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            const member = await createInvite(
                actor,
                String(body.email ?? ''),
                sanitizePermissionsInput(body.permissions),
            );
            return json({ member }, 201);
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Failed to invite' }, 400);
        }
    }

    const memberResendMatch = path.match(/^\/api\/members\/([^/]+)\/resend$/);
    if (memberResendMatch && method === 'POST') {
        try {
            return json({ member: await resendInvite(actor, memberResendMatch[1]) });
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            throw err;
        }
    }

    const memberMatch = path.match(/^\/api\/members\/([^/]+)$/);
    if (memberMatch) {
        if (method === 'PUT') {
            const body = await req.json().catch(() => ({}));
            try {
                const member = await updateMemberPermissions(
                    actor,
                    memberMatch[1],
                    sanitizePermissionsInput(body.permissions ?? body),
                );
                return json({ member });
            } catch (err: any) {
                if (err instanceof AuthError) return json({ error: err.message }, err.status);
                throw err;
            }
        }
        if (method === 'DELETE') {
            try {
                const ok = await revokeMember(actor, memberMatch[1]);
                return ok ? json({ ok: true }) : json({ error: 'Not found' }, 404);
            } catch (err: any) {
                if (err instanceof AuthError) return json({ error: err.message }, err.status);
                throw err;
            }
        }
    }

    if (path === '/api/channels' && method === 'GET') {
        const channels = await listAllChannels(actor.accountId);
        const access = actor.permissions.channelAccess;
        const visible =
            actor.role === 'owner' || access === 'all'
                ? channels
                : channels.filter(
                      (c) =>
                          c.source === 'db' &&
                          c.resourceId &&
                          access.includes(c.resourceId),
                  );
        return json({ channels: visible });
    }

    if (path === '/api/platforms' && method === 'GET') {
        return json({ platforms: listPlatformsMeta() });
    }

    if (path === '/api/platform-configs' && method === 'GET') {
        return json({ configs: await listPlatformConfigs(actor.accountId) });
    }

    if (path === '/api/threads/oauth/start' && method === 'POST') {
        try {
            assertPermission(actor, 'canManageChannels');
            return json(await createThreadsOAuthStart(actor.accountId, url.origin));
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json(
                { error: err?.message || 'Failed to start Threads OAuth' },
                400,
            );
        }
    }

    const platformConfigMatch = path.match(
        /^\/api\/platform-configs\/([^/]+)$/,
    );
    if (platformConfigMatch && method === 'PUT') {
        const body = await req.json().catch(() => ({}));
        try {
            assertPermission(actor, 'canManageChannels');
            const config = await upsertPlatformConfig(
                actor.accountId,
                platformConfigMatch[1],
                body,
            );
            return json({ config });
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json(
                { error: err?.message || 'Failed to save platform settings' },
                400,
            );
        }
    }

    if (path === '/api/validate' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        // Only validate against platforms the user actually selected as targets —
        // e.g. a Threads character-limit issue is noise if this post isn't going to Threads.
        const targetIds = new Set(
            Array.isArray(body.platforms) ? body.platforms.map(String) : [],
        );
        const targetPlatforms = listPlatforms().filter((platform) =>
            targetIds.has(platform.id),
        );
        return json(
            validateMarkdown(String(body.markdown ?? ''), targetPlatforms),
        );
    }

    if (path === '/api/preview' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json(
            previewContent(String(body.markdown ?? ''), listPlatforms()),
        );
    }

    if (path === '/api/channels' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            assertPermission(actor, 'canManageChannels');
            const channel = await createChannelResource(actor.accountId, body);
            return json({ channel }, 201);
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Failed to save channel' }, 400);
        }
    }

    const channelMatch = path.match(/^\/api\/channels\/([^/]+)$/);
    if (channelMatch) {
        const id = channelMatch[1];
        if (method === 'PUT') {
            const body = await req.json().catch(() => ({}));
            try {
                assertPermission(actor, 'canManageChannels');
                const channel = await updateChannelResource(actor.accountId, id, body);
                return channel
                    ? json({ channel })
                    : json({ error: 'Not found' }, 404);
            } catch (err: any) {
                if (err instanceof AuthError) return json({ error: err.message }, err.status);
                return json(
                    { error: err?.message || 'Failed to update channel' },
                    400,
                );
            }
        }
        if (method === 'DELETE') {
            try {
                assertPermission(actor, 'canManageChannels');
                const ok = await deleteChannelResource(actor.accountId, id);
                return ok ? json({ ok: true }) : json({ error: 'Not found' }, 404);
            } catch (err: any) {
                if (err instanceof AuthError) return json({ error: err.message }, err.status);
                throw err;
            }
        }
    }

    if (path === '/api/publications' && method === 'GET') {
        const draftId = url.searchParams.get('draftId') || undefined;
        return json({
            publications: await listPublications(actor.accountId, draftId),
        });
    }

    const publicationByIdMatch = path.match(/^\/api\/publications\/([^/]+)$/);
    if (publicationByIdMatch && method === 'GET') {
        const publication = await getPublication(actor.accountId, publicationByIdMatch[1]);
        return publication
            ? json({ publication })
            : json({ error: 'Not found' }, 404);
    }

    if (path === '/api/scheduled-publications' && method === 'GET') {
        return json({
            scheduledPublications: await listScheduledPublications(actor.accountId),
        });
    }

    if (path === '/api/scheduled-publications' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            assertPermission(actor, 'canPublish');
            const draftId = String(body.draftId ?? '');
            const draft = await getDraft(actor.userId, draftId);
            if (draft?.targets.length) {
                const resourceMap = await buildResourceIdMap(actor.accountId);
                assertChannelAccess(actor, draft.targets, resourceMap);
            }
            const scheduledPublication = await createScheduledPublication(
                actor.userId,
                actor.accountId,
                body,
            );
            return json({ scheduledPublication }, 201);
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Failed to schedule' }, 400);
        }
    }

    const scheduledMatch = path.match(
        /^\/api\/scheduled-publications\/([^/]+)$/,
    );
    if (scheduledMatch && method === 'DELETE') {
        try {
            assertPermission(actor, 'canDelete');
            const scheduledPublication = await cancelScheduledPublication(
                actor.accountId,
                scheduledMatch[1],
            );
            return scheduledPublication
                ? json({ scheduledPublication })
                : json({ error: 'Not found' }, 404);
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            throw err;
        }
    }

    const publicationMatch = path.match(/^\/api\/publications\/([^/]+)\/(update|delete)$/);
    if (publicationMatch) {
        const [, publicationId, action] = publicationMatch;

        if (action === 'delete' && method === 'POST') {
            try {
                assertPermission(actor, 'canDelete');
            } catch (err: any) {
                return json({ error: err.message }, err.status);
            }
            const outcome = await deletePublishedTargets(actor.accountId, publicationId);
            return 'error' in outcome
                ? json({ error: outcome.error }, outcome.status)
                : json(outcome);
        }

        if (action === 'update' && method === 'POST') {
            try {
                assertPermission(actor, 'canPublish');
            } catch (err: any) {
                return json({ error: err.message }, err.status);
            }
            const body = await req.json().catch(() => ({}));
            const outcome = await updatePublishedTargets(
                actor.accountId,
                publicationId,
                body,
            );
            return 'error' in outcome
                ? json({ error: outcome.error }, outcome.status)
                : json(outcome);
        }
    }

    if (path === '/api/publish' && method === 'POST') {
        try {
            const parsed = await parsePublishRequest(req, actor.userId);
            assertPermission(actor, 'canPublish');
            const resourceMap = await buildResourceIdMap(actor.accountId);
            assertChannelAccess(actor, parsed.targets, resourceMap);
            return json(await executePublish(actor.accountId, parsed));
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Publish failed' }, 400);
        }
    }

    // --- Image uploads ---
    if (path === '/api/uploads' && method === 'POST') {
        const form = await req.formData();
        const file = form.get('file');
        if (!(file instanceof File)) {
            return json({ error: 'No file provided' }, 400);
        }
        const bytes = Buffer.from(await file.arrayBuffer());
        try {
            const saved = await saveUpload(
                actor.userId,
                file.name,
                file.type || 'application/octet-stream',
                bytes,
            );
            return json(saved, 201);
        } catch (err: any) {
            // Validation failures (not-an-image, too large) → 400, not 500.
            return json({ error: err?.message || 'Upload failed' }, 400);
        }
    }

    const uploadMatch = path.match(/^\/api\/uploads\/([^/]+)$/);
    if (uploadMatch && method === 'GET') {
        const doc = await getUpload(actor.userId, uploadMatch[1]);
        if (!doc) return json({ error: 'Not found' }, 404);
        const data = Buffer.isBuffer(doc.data)
            ? doc.data
            : Buffer.from(doc.data as any);
        return new Response(data, {
            headers: {
                'content-type': doc.contentType,
                'cache-control': 'private, max-age=86400',
            },
        });
    }

    // --- Drafts CRUD (private per member — not shared with the account) ---
    if (path === '/api/drafts' && method === 'GET') {
        return json({ drafts: await listDrafts(actor.userId) });
    }
    if (path === '/api/drafts' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json({ draft: await createDraft(actor.userId, body) }, 201);
    }

    const draftMatch = path.match(/^\/api\/drafts\/([^/]+)$/);
    if (draftMatch) {
        const id = draftMatch[1];
        if (method === 'GET') {
            const draft = await getDraft(actor.userId, id);
            return draft ? json({ draft }) : json({ error: 'Not found' }, 404);
        }
        if (method === 'PUT') {
            const body = await req.json().catch(() => ({}));
            const draft = await updateDraft(actor.userId, id, body);
            return draft ? json({ draft }) : json({ error: 'Not found' }, 404);
        }
        if (method === 'DELETE') {
            const ok = await deleteDraft(actor.userId, id);
            if (!ok) return json({ error: 'Not found' }, 404);
            const [scheduledDeleted, publicationsDeleted] = await Promise.all([
                deleteScheduledPublicationsForDraft(actor.userId, id),
                deletePublicationsForDraft(actor.accountId, id),
            ]);
            return json({
                ok: true,
                deleted: {
                    scheduledPublications: scheduledDeleted,
                    publications: publicationsDeleted,
                },
            });
        }
    }

    return json({ error: 'Not found' }, 404);
}

function createServer(port: number) {
    return Bun.serve({
        port,
        idleTimeout: 60,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname.startsWith('/api/')) {
                try {
                    return await handleApi(req, url);
                } catch (error: any) {
                    if (error instanceof AuthError) {
                        return json({ error: error.message }, error.status);
                    }
                    console.error('API error:', error);
                    return json(
                        { error: error?.message || 'Internal server error' },
                        500,
                    );
                }
            }
            return serveStatic(url.pathname);
        },
    });
}

function isPortBusyError(error: any): boolean {
    const message = String(error?.message ?? error ?? '');
    return (
        error?.code === 'EADDRINUSE' ||
        message.includes('EADDRINUSE') ||
        message.includes('port') && message.includes('in use')
    );
}

export function startServer(): void {
    const rawPort = process.env.PORT;
    const requestedPort = rawPort === '0' ? 0 : Number(rawPort) || 3000;

    if (requestedPort === 0) {
        const server = createServer(0);
        console.log(`HTTP server listening on http://localhost:${server.port}`);
        return;
    }

    const maxPort = Number(process.env.PORT_MAX) || requestedPort + 50;

    for (let port = requestedPort; port <= maxPort; port++) {
        try {
            const server = createServer(port);
            if (port !== requestedPort) {
                console.warn(
                    `Port ${requestedPort} is busy; using http://localhost:${server.port}`,
                );
            }
            console.log(`HTTP server listening on http://localhost:${server.port}`);
            return;
        } catch (error: any) {
            if (isPortBusyError(error)) {
                continue;
            }
            throw error;
        }
    }

    throw new Error(
        `No free port found in range ${requestedPort}-${maxPort}`,
    );
}
