import { join, normalize } from 'path';
import {
    AuthError,
    changePassword,
    loginUser,
    registerUser,
    requireAuth,
} from './auth';
import { verifyEmailToken, resendVerification } from './emailVerification';
import { requestPasswordReset, resetPassword } from './passwordReset';
import { confirmEmailChange, requestEmailChange } from './emailChange';
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
    isDesktopOnlyPlatform,
    listAllChannels,
    listPlatforms,
    listPlatformsMeta,
} from './platforms/registry';
import {
    createDraft,
    deleteDraft,
    getDraft,
    listDrafts,
    organizeDraft,
    updateDraft,
} from './drafts';
import {
    createDraftFolder,
    deleteDraftFolder,
    listDraftFolders,
    renameDraftFolder,
    reorderDraftFolders,
} from './draftFolders';
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
import { json } from './httpResponses';
import { getUpload, saveUpload } from './uploads';
import {
    createPairingCode,
    heartbeatLocalPublisher,
    listLocalPublishers,
    pairLocalPublisher,
    revokeLocalPublisher,
} from './localPublisherAgents';
import {
    claimLocalPublisherJob,
    completeLocalPublisherJob,
} from './localPublisherJobs';
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

// The Next static export is copied here by frontend/scripts/copy-static-export.ts.
const PUBLIC_DIR = join(import.meta.dir, '..', 'public');
const NOT_BUILT_HTML =
    '<!doctype html><meta charset="utf-8"><title>Composer</title>' +
    '<body style="font-family:sans-serif;padding:40px;max-width:640px;margin:auto">' +
    '<h1>Frontend not built</h1><p>Run <code>bun run build</code> (or start the Next.js dev ' +
    'server with <code>cd frontend &amp;&amp; bun run dev</code>) to build the UI into ' +
    '<code>public/</code>.</p></body>';

function isDesktopClient(req: Request): boolean {
    return (
        req.headers.get('x-composer-client') === 'desktop' ||
        req.headers.get('user-agent')?.includes('ComposerDesktop/') === true
    );
}

function assertPlatformAvailableToClient(
    req: Request,
    platformIds: Iterable<string>,
): void {
    if (isDesktopClient(req)) return;
    if ([...platformIds].some(isDesktopOnlyPlatform)) {
        throw new Error('Threads and X are available only in Composer Desktop');
    }
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
    if (path === '/api/local-publishers/pair' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            return json(await pairLocalPublisher(body), 201);
        } catch (error: unknown) {
            return json(
                {
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Pairing failed',
                },
                400,
            );
        }
    }

    if (path === '/api/local-publishers/heartbeat' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            return json(
                await heartbeatLocalPublisher(
                    req.headers.get('x-local-publisher-token') || '',
                    body.platforms,
                ),
            );
        } catch {
            return json({ error: 'Local publisher authentication failed' }, 401);
        }
    }

    if (path === '/api/local-publishers/jobs/claim' && method === 'POST') {
        try {
            return json({
                job: await claimLocalPublisherJob(
                    req.headers.get('x-local-publisher-token') || '',
                ),
            });
        } catch {
            return json({ error: 'Local publisher authentication failed' }, 401);
        }
    }

    const localJobCompleteMatch = path.match(
        /^\/api\/local-publishers\/jobs\/([^/]+)\/complete$/,
    );
    if (localJobCompleteMatch && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const completed = await completeLocalPublisherJob(
            req.headers.get('x-local-publisher-token') || '',
            localJobCompleteMatch[1],
            body,
        );
        return completed
            ? json({ ok: true })
            : json({ error: 'Job lease is invalid or expired' }, 409);
    }

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

    if (path === '/api/auth/request-password-reset' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        await requestPasswordReset(String(body.email ?? ''));
        return json({ ok: true });
    }

    const resetPasswordMatch = path.match(/^\/api\/auth\/reset-password\/([^/]+)$/);
    if (resetPasswordMatch && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            const result = await resetPassword(resetPasswordMatch[1], body.password);
            return json(result);
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Reset failed' }, 400);
        }
    }

    const confirmEmailChangeMatch = path.match(
        /^\/api\/auth\/confirm-email-change\/([^/]+)$/,
    );
    if (confirmEmailChangeMatch && method === 'POST') {
        try {
            const result = await confirmEmailChange(confirmEmailChangeMatch[1]);
            return json({ ok: true, email: result.email });
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Confirmation failed' }, 400);
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

    if (path === '/api/auth/change-password' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            await changePassword(actor, body.currentPassword, body.newPassword);
            return json({ ok: true });
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Failed to change password' }, 400);
        }
    }

    if (path === '/api/auth/request-email-change' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            await requestEmailChange(actor, String(body.newEmail ?? ''), body.password);
            return json({ ok: true });
        } catch (err: any) {
            if (err instanceof AuthError) return json({ error: err.message }, err.status);
            return json({ error: err?.message || 'Failed to request email change' }, 400);
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
        const channels = await listAllChannels(
            actor.accountId,
            isDesktopClient(req),
        );
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
        return json({ platforms: listPlatformsMeta(isDesktopClient(req)) });
    }

    if (path === '/api/platform-configs' && method === 'GET') {
        const configs = await listPlatformConfigs(actor.accountId);
        return json({
            configs: isDesktopClient(req)
                ? configs
                : configs.filter(
                      (config) => !isDesktopOnlyPlatform(config.platform),
                  ),
        });
    }

    if (path === '/api/local-publishers' && method === 'GET') {
        return json({ agents: await listLocalPublishers(actor.accountId) });
    }

    if (path === '/api/local-publishers/pairing' && method === 'POST') {
        assertPermission(actor, 'canManageChannels');
        return json(createPairingCode(actor.accountId), 201);
    }

    const localPublisherMatch = path.match(
        /^\/api\/local-publishers\/([^/]+)$/,
    );
    if (localPublisherMatch && method === 'DELETE') {
        assertPermission(actor, 'canManageChannels');
        const revoked = await revokeLocalPublisher(
            actor.accountId,
            localPublisherMatch[1],
        );
        return revoked
            ? json({ ok: true })
            : json({ error: 'Not found' }, 404);
    }

    const platformConfigMatch = path.match(
        /^\/api\/platform-configs\/([^/]+)$/,
    );
    if (platformConfigMatch && method === 'PUT') {
        const body = await req.json().catch(() => ({}));
        try {
            assertPermission(actor, 'canManageChannels');
            assertPlatformAvailableToClient(req, [platformConfigMatch[1]]);
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
            targetIds.has(platform.id) &&
            (isDesktopClient(req) || !platform.desktopOnly),
        );
        return json(
            validateMarkdown(String(body.markdown ?? ''), targetPlatforms),
        );
    }

    if (path === '/api/preview' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json(
            previewContent(
                String(body.markdown ?? ''),
                listPlatforms().filter(
                    (platform) =>
                        isDesktopClient(req) || !platform.desktopOnly,
                ),
            ),
        );
    }

    if (path === '/api/channels' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        try {
            assertPermission(actor, 'canManageChannels');
            assertPlatformAvailableToClient(req, [String(body.platform ?? '')]);
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
                assertPlatformAvailableToClient(
                    req,
                    draft.targets.map((target) => target.platform),
                );
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
            assertPlatformAvailableToClient(
                req,
                parsed.targets.map((target) => target.platform),
            );
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

    // --- Draft folders (private per member, like the drafts they organize) ---
    if (path === '/api/draft-folders' && method === 'GET') {
        return json({ folders: await listDraftFolders(actor.userId) });
    }
    if (path === '/api/draft-folders' && method === 'POST') {
        const body = await req.json().catch(() => ({}));
        return json(
            { folder: await createDraftFolder(actor.userId, body.name) },
            201,
        );
    }
    // Matched before the :id route — 'order' is not a folder id.
    if (path === '/api/draft-folders/order' && method === 'PUT') {
        const body = await req.json().catch(() => ({}));
        return json({
            folders: await reorderDraftFolders(actor.userId, body.ids),
        });
    }

    const draftFolderMatch = path.match(/^\/api\/draft-folders\/([^/]+)$/);
    if (draftFolderMatch) {
        const id = draftFolderMatch[1];
        if (method === 'PUT') {
            const body = await req.json().catch(() => ({}));
            const folder = await renameDraftFolder(actor.userId, id, body.name);
            return folder
                ? json({ folder })
                : json({ error: 'Not found' }, 404);
        }
        if (method === 'DELETE') {
            const ok = await deleteDraftFolder(actor.userId, id);
            return ok ? json({ ok: true }) : json({ error: 'Not found' }, 404);
        }
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
        if (method === 'PATCH') {
            const body = await req.json().catch(() => ({}));
            const draft = await organizeDraft(actor.userId, id, body);
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
        // Docker publishes the container IP, not the container's loopback.
        hostname: '0.0.0.0',
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
