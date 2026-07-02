import { join, normalize } from 'path';
import { AuthError, loginUser, registerUser, requireAuth } from './auth';
import {
    deleteTargets,
    listAllChannels,
    publishToTargets,
    updateTargets,
    type PublishTarget,
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
import { getUpload, resolveImages, saveUpload } from './uploads';
import { markdownToTelegramHtml } from './converters/markdown';
import { markdownToDiscord } from './converters/markdown';
import { splitTextIntoChunks, TELEGRAM_LIMIT } from './chunk';
import { validateTelegramHtml } from './telegramValidation';
import {
    createPublication,
    deletePublicationRecord,
    getPublication,
    listPublications,
    updatePublicationResults,
} from './publications';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per image

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

function lineInfo(markdown: string, index: number) {
    const before = markdown.slice(0, Math.max(0, index));
    const line = before.split('\n').length;
    const lineStart = markdown.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
    const nextNewline = markdown.indexOf('\n', index);
    const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
    return {
        line,
        excerpt: markdown.slice(lineStart, lineEnd).trim(),
    };
}

function findLikelyMarkdownSource(markdown: string, tag?: string) {
    const checks: Array<[RegExp, string[]]> = [
        [/^>\s?.+/m, ['blockquote']],
        [/```[\s\S]*?```/, ['pre']],
        [/`[^`\n]+`/, ['code']],
        [/\|\|[\s\S]+?\|\|/, ['tg-spoiler']],
        [/__[\s\S]+?__/, ['u', 'ins']],
        [/\*\*[\s\S]+?\*\*/, ['b', 'strong']],
        [/~~[\s\S]+?~~/, ['s', 'strike', 'del']],
        [/\*[^*\n]+?\*/, ['i', 'em']],
        [/\[[^\]]+]\([^)]+\)/, ['a']],
    ];

    for (const [pattern, tags] of checks) {
        if (tag && !tags.includes(tag)) continue;
        const match = pattern.exec(markdown);
        if (match?.index !== undefined) return lineInfo(markdown, match.index);
    }

    return undefined;
}

function htmlContext(chunk: string, offset?: number) {
    if (offset === undefined) return undefined;
    const start = Math.max(0, offset - 80);
    const end = Math.min(chunk.length, offset + 140);
    return chunk.slice(start, end);
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
        const markdown = String(body.markdown ?? '');
        const telegramHtml = markdownToTelegramHtml(markdown);
        const chunks = splitTextIntoChunks(telegramHtml, TELEGRAM_LIMIT, true);
        const issues = chunks.flatMap((chunk, index) =>
            validateTelegramHtml(chunk).map((issue) => {
                const source = findLikelyMarkdownSource(markdown, issue.tag);
                return {
                    platform: 'telegram',
                    chunk: index + 1,
                    ...issue,
                    line: source?.line,
                    excerpt: source?.excerpt,
                    htmlContext: htmlContext(chunk, issue.offset),
                };
            }),
        );

        return json({ ok: issues.length === 0, issues });
    }

    if (path === '/api/preview' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const markdown = String(body.markdown ?? '');
        return json({
            telegramHtml: markdownToTelegramHtml(markdown),
            discord: markdownToDiscord(markdown),
        });
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
        const publicationId = publicationMatch[1];
        const action = publicationMatch[2];
        const publication = await getPublication(user.id, publicationId);
        if (!publication) return json({ error: 'Not found' }, 404);

        const refs = publication.targets
            .filter((target) => target.ok && target.messageIds.length)
            .map((target) => ({
                platform: target.platform,
                channelId: target.channelId,
                messageIds: target.messageIds,
            }));

        if (!refs.length) {
            return json({ error: 'No stored message ids for this publication' }, 400);
        }

        if (action === 'delete' && method === 'POST') {
            const results = await deleteTargets(refs);
            const ok = results.every((result) => result.ok);
            if (ok) await deletePublicationRecord(user.id, publicationId);
            return json({ results, deleted: ok });
        }

        if (action === 'update' && method === 'POST') {
            const body = await req.json().catch(() => ({}));
            const markdown = String(body.markdown ?? publication.markdown ?? '');
            const imageUrls = Array.isArray(body.imageUrls)
                ? body.imageUrls.map(String)
                : [];
            if (!markdown.trim() && !imageUrls.length) {
                return json({ error: 'Content is empty' }, 400);
            }
            const results = await updateTargets(refs, {
                markdown,
                imageUrls,
            });
            const updated = await updatePublicationResults(user.id, publicationId, {
                title: String(body.title ?? publication.title ?? 'Untitled'),
                markdown,
                imageUrls,
                results,
            });
            return json({ results, publication: updated });
        }
    }

    if (path === '/api/publish' && method === 'POST') {
        const contentType = req.headers.get('content-type') || '';
        let markdown = '';
        let draftId = '';
        let title = '';
        let targets: PublishTarget[] = [];
        let imageUrls: string[] = [];
        let images: Array<{
            data: Uint8Array;
            filename: string;
            contentType?: string;
        }> = [];

        if (contentType.includes('multipart/form-data')) {
            const form = await req.formData();
            markdown = String(form.get('markdown') ?? '');
            draftId = String(form.get('draftId') ?? '');
            title = String(form.get('title') ?? '');
            try {
                targets = JSON.parse(String(form.get('targets') ?? '[]'));
                imageUrls = JSON.parse(String(form.get('imageUrls') ?? '[]'));
            } catch {
                return json({ error: 'Invalid publish payload' }, 400);
            }

            const files = form
                .getAll('images')
                .filter((f): f is File => f instanceof File);
            try {
                images = await Promise.all(
                    files.map(async (file) => {
                        if (!(file.type || '').startsWith('image/')) {
                            throw new Error(`"${file.name}" is not an image`);
                        }
                        if (file.size > MAX_UPLOAD_BYTES) {
                            throw new Error(
                                `"${file.name}" is larger than 10 MB`,
                            );
                        }
                        return {
                            data: new Uint8Array(await file.arrayBuffer()),
                            filename: file.name || 'image',
                            contentType: file.type,
                        };
                    }),
                );
            } catch (err: any) {
                return json({ error: err?.message || 'Invalid image' }, 400);
            }
        } else {
            const body = await req.json().catch(() => ({}));
            markdown = String(body.markdown ?? '');
            draftId = String(body.draftId ?? '');
            title = String(body.title ?? '');
            targets = Array.isArray(body.targets) ? body.targets : [];
            imageUrls = Array.isArray(body.imageUrls)
                ? body.imageUrls.map(String)
                : [];
            const imageIds: string[] = Array.isArray(body.imageIds)
                ? body.imageIds.map(String)
                : [];
            images = await resolveImages(user.id, imageIds);
        }

        if (!Array.isArray(targets)) {
            targets = [];
        }
        if (!targets.length) {
            return json({ error: 'No channels selected' }, 400);
        }
        if (!markdown.trim() && !imageUrls.length && !images.length) {
            return json({ error: 'Content is empty' }, 400);
        }
        const results = await publishToTargets(targets, {
            markdown,
            imageUrls,
            images,
        });
        const publication = draftId
            ? await createPublication(user.id, {
                  draftId,
                  title: title || 'Untitled',
                  markdown,
                  imageUrls,
                  results,
              })
            : null;
        return json({ results, publication });
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
