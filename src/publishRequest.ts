import { publishToTargets, type PublishTarget } from './platforms/registry';
import type { PublishImage, PublishResult } from './platforms/types';
import { createPublication } from './publications';
import { resolveImages } from './uploads';
import type { Publication } from '../shared/types';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per image

export interface ParsedPublishRequest {
    markdown: string;
    draftId: string;
    title: string;
    targets: PublishTarget[];
    imageUrls: string[];
    images: PublishImage[];
}

async function parseMultipartPublish(
    req: Request,
): Promise<ParsedPublishRequest> {
    const form = await req.formData();
    const markdown = String(form.get('markdown') ?? '');
    const draftId = String(form.get('draftId') ?? '');
    const title = String(form.get('title') ?? '');

    let targets: PublishTarget[];
    let imageUrls: string[];
    try {
        targets = JSON.parse(String(form.get('targets') ?? '[]'));
        imageUrls = JSON.parse(String(form.get('imageUrls') ?? '[]'));
    } catch {
        throw new Error('Invalid publish payload');
    }

    const files = form
        .getAll('images')
        .filter((f): f is File => f instanceof File);
    let images: PublishImage[];
    try {
        images = await Promise.all(
            files.map(async (file) => {
                if (!(file.type || '').startsWith('image/')) {
                    throw new Error(`"${file.name}" is not an image`);
                }
                if (file.size > MAX_UPLOAD_BYTES) {
                    throw new Error(`"${file.name}" is larger than 10 MB`);
                }
                return {
                    data: new Uint8Array(await file.arrayBuffer()),
                    filename: file.name || 'image',
                    contentType: file.type,
                };
            }),
        );
    } catch (err: any) {
        throw new Error(err?.message || 'Invalid image');
    }

    return { markdown, draftId, title, targets, imageUrls, images };
}

async function parseJsonPublish(
    req: Request,
    authorId: string,
): Promise<ParsedPublishRequest> {
    const body = await req.json().catch(() => ({}));
    const markdown = String(body.markdown ?? '');
    const draftId = String(body.draftId ?? '');
    const title = String(body.title ?? '');
    const targets: PublishTarget[] = Array.isArray(body.targets)
        ? body.targets
        : [];
    const imageUrls: string[] = Array.isArray(body.imageUrls)
        ? body.imageUrls.map(String)
        : [];
    const imageIds: string[] = Array.isArray(body.imageIds)
        ? body.imageIds.map(String)
        : [];
    const images = await resolveImages(authorId, imageIds);

    return { markdown, draftId, title, targets, imageUrls, images };
}

/**
 * Parse either a multipart/form-data or JSON /api/publish request body.
 * `authorId` is the acting member, used only to resolve their own private
 * image uploads referenced by id — unrelated to which account is publishing.
 */
export async function parsePublishRequest(
    req: Request,
    authorId: string,
): Promise<ParsedPublishRequest> {
    const contentType = req.headers.get('content-type') || '';
    const parsed = contentType.includes('multipart/form-data')
        ? await parseMultipartPublish(req)
        : await parseJsonPublish(req, authorId);

    if (!Array.isArray(parsed.targets)) parsed.targets = [];
    return parsed;
}

export interface PublishOutcome {
    results: PublishResult[];
    publication: Publication | null;
}

/** Validate + fan the parsed request out to the target platforms, recording a publication. */
export async function executePublish(
    accountId: string,
    parsed: ParsedPublishRequest,
): Promise<PublishOutcome> {
    if (!parsed.targets.length) {
        throw new Error('No channels selected');
    }
    if (
        !parsed.markdown.trim() &&
        !parsed.imageUrls.length &&
        !parsed.images.length
    ) {
        throw new Error('Content is empty');
    }

    const results = await publishToTargets(
        parsed.targets,
        {
            markdown: parsed.markdown,
            imageUrls: parsed.imageUrls,
            images: parsed.images,
        },
        accountId,
    );
    const publication = parsed.draftId
        ? await createPublication(accountId, {
              draftId: parsed.draftId,
              title: parsed.title || 'Untitled',
              markdown: parsed.markdown,
              imageUrls: parsed.imageUrls,
              results,
          })
        : null;
    return { results, publication };
}
