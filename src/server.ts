import { join, normalize } from 'path';
import { AuthError, loginUser, registerUser, requireAuth } from './auth';
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

async function handleApi(req: Request, url: URL): Promise<Response> {
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
    const user = await requireAuth(req);

    if (path === '/api/me' && method === 'GET') {
        return json({ user });
    }

    if (path === '/api/channels' && method === 'GET') {
        return json({ channels: await listAllChannels(user.id) });
    }

    if (path === '/api/platforms' && method === 'GET') {
        return json({ platforms: listPlatformsMeta() });
    }

    if (path === '/api/platform-configs' && method === 'GET') {
        return json({ configs: await listPlatformConfigs(user.id) });
    }

    if (path === '/api/threads/oauth/start' && method === 'POST') {
        try {
            return json(await createThreadsOAuthStart(user.id, url.origin));
        } catch (err: any) {
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
            const config = await upsertPlatformConfig(
                user.id,
                platformConfigMatch[1],
                body,
            );
            return json({ config });
        } catch (err: any) {
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
            const channel = await createChannelResource(user.id, body);
            return json({ channel }, 201);
        } catch (err: any) {
            return json({ error: err?.message || 'Failed to save channel' }, 400);
        }
    }

    const channelMatch = path.match(/^\/api\/channels\/([^/]+)$/);
    if (channelMatch) {
        const id = channelMatch[1];
        if (method === 'PUT') {
            const body = await req.json().catch(() => ({}));
            try {
                const channel = await updateChannelResource(user.id, id, body);
                return channel
                    ? json({ channel })
                    : json({ error: 'Not found' }, 404);
            } catch (err: any) {
                return json(
                    { error: err?.message || 'Failed to update channel' },
                    400,
                );
            }
        }
        if (method === 'DELETE') {
            const ok = await deleteChannelResource(user.id, id);
            return ok ? json({ ok: true }) : json({ error: 'Not found' }, 404);
        }
    }

    if (path === '/api/publications' && method === 'GET') {
        const draftId = url.searchParams.get('draftId') || undefined;
        return json({
            publications: await listPublications(user.id, draftId),
        });
    }

    const publicationByIdMatch = path.match(/^\/api\/publications\/([^/]+)$/);
    if (publicationByIdMatch && method === 'GET') {
        const publication = await getPublication(user.id, publicationByIdMatch[1]);
        return publication
            ? json({ publication })
            : json({ error: 'Not found' }, 404);
    }

    if (path === '/api/scheduled-publications' && method === 'GET') {
        return json({
            scheduledPublications: await listScheduledPublications(user.id),
        });
    }

    if (path === '/api/scheduled-publications' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            const scheduledPublication = await createScheduledPublication(
                user.id,
                body,
            );
            return json({ scheduledPublication }, 201);
        } catch (err: any) {
            return json({ error: err?.message || 'Failed to schedule' }, 400);
        }
    }

    const scheduledMatch = path.match(
        /^\/api\/scheduled-publications\/([^/]+)$/,
    );
    if (scheduledMatch && method === 'DELETE') {
        const scheduledPublication = await cancelScheduledPublication(
            user.id,
            scheduledMatch[1],
        );
        return scheduledPublication
            ? json({ scheduledPublication })
            : json({ error: 'Not found' }, 404);
    }

    const publicationMatch = path.match(/^\/api\/publications\/([^/]+)\/(update|delete)$/);
    if (publicationMatch) {
        const [, publicationId, action] = publicationMatch;

        if (action === 'delete' && method === 'POST') {
            const outcome = await deletePublishedTargets(user.id, publicationId);
            return 'error' in outcome
                ? json({ error: outcome.error }, outcome.status)
                : json(outcome);
        }

        if (action === 'update' && method === 'POST') {
            const body = await req.json().catch(() => ({}));
            const outcome = await updatePublishedTargets(
                user.id,
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
            const parsed = await parsePublishRequest(req, user.id);
            return json(await executePublish(user.id, parsed));
        } catch (err: any) {
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
                user.id,
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
        const doc = await getUpload(user.id, uploadMatch[1]);
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

    // --- Drafts CRUD ---
    if (path === '/api/drafts' && method === 'GET') {
        return json({ drafts: await listDrafts(user.id) });
    }
    if (path === '/api/drafts' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json({ draft: await createDraft(user.id, body) }, 201);
    }

    const draftMatch = path.match(/^\/api\/drafts\/([^/]+)$/);
    if (draftMatch) {
        const id = draftMatch[1];
        if (method === 'GET') {
            const draft = await getDraft(user.id, id);
            return draft ? json({ draft }) : json({ error: 'Not found' }, 404);
        }
        if (method === 'PUT') {
            const body = await req.json().catch(() => ({}));
            const draft = await updateDraft(user.id, id, body);
            return draft ? json({ draft }) : json({ error: 'Not found' }, 404);
        }
        if (method === 'DELETE') {
            const ok = await deleteDraft(user.id, id);
            if (!ok) return json({ error: 'Not found' }, 404);
            const [scheduledDeleted, publicationsDeleted] = await Promise.all([
                deleteScheduledPublicationsForDraft(user.id, id),
                deletePublicationsForDraft(user.id, id),
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
