import { join, normalize } from 'path';
import { AuthError, loginUser, registerUser, requireAuth } from './auth';
import { listAllChannels } from './platforms/registry';
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
import { getUpload, saveUpload } from './uploads';
import { validateMarkdown, previewContent } from './validation';
import { parsePublishRequest, executePublish } from './publishRequest';
import {
    deletePublishedTargets,
    listPublications,
    updatePublishedTargets,
} from './publications';

// The Vite build outputs the frontend here (see frontend/vite.config.ts).
const PUBLIC_DIR = join(import.meta.dir, '..', 'public');
const NOT_BUILT_HTML =
    '<!doctype html><meta charset="utf-8"><title>Composer</title>' +
    '<body style="font-family:sans-serif;padding:40px;max-width:640px;margin:auto">' +
    '<h1>Frontend not built</h1><p>Run <code>bun run build</code> (or start the Vite dev ' +
    'server with <code>cd frontend &amp;&amp; bun run dev</code>) to build the UI into ' +
    '<code>public/</code>.</p></body>';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

async function serveStatic(pathname: string): Promise<Response> {
    // Prevent path traversal; default to index.html for the SPA.
    const rel = pathname === '/' ? '/index.html' : pathname;
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const file = Bun.file(join(PUBLIC_DIR, safe));
    if (await file.exists()) {
        return new Response(file);
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

    // --- Everything below requires authentication ---
    const user = await requireAuth(req);

    if (path === '/api/me' && method === 'GET') {
        return json({ user });
    }

    if (path === '/api/channels' && method === 'GET') {
        return json({ channels: await listAllChannels() });
    }

    if (path === '/api/validate' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json(validateMarkdown(String(body.markdown ?? '')));
    }

    if (path === '/api/preview' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json(previewContent(String(body.markdown ?? '')));
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
                const channel = await updateChannelResource(id, body);
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
            const ok = await deleteChannelResource(id);
            return ok ? json({ ok: true }) : json({ error: 'Not found' }, 404);
        }
    }

    if (path === '/api/publications' && method === 'GET') {
        const draftId = url.searchParams.get('draftId') || undefined;
        return json({
            publications: await listPublications(user.id, draftId),
        });
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
            return ok ? json({ ok: true }) : json({ error: 'Not found' }, 404);
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
