import { ObjectId } from 'mongodb';
import { uploads, type UploadDoc } from './db';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ResolvedImage {
    data: Buffer;
    filename: string;
    contentType: string;
}

export async function saveUpload(
    userId: string,
    filename: string,
    contentType: string,
    bytes: Buffer,
): Promise<{ id: string; filename: string; size: number }> {
    if (!contentType.startsWith('image/')) {
        throw new Error('Only image files are allowed');
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
        throw new Error('Image is too large (max 10 MB)');
    }

    const doc: UploadDoc = {
        userId,
        filename: filename || 'image',
        contentType,
        data: bytes,
        size: bytes.length,
        createdAt: new Date(),
    };
    const result = await uploads().insertOne(doc);
    return { id: result.insertedId.toString(), filename: doc.filename, size: doc.size };
}

/** Fetch a single upload owned by the user (for browser preview). */
export async function getUpload(
    userId: string,
    id: string,
): Promise<UploadDoc | null> {
    if (!ObjectId.isValid(id)) return null;
    return uploads().findOne({ _id: new ObjectId(id), userId });
}

/** Resolve a list of upload ids (owned by the user) to sendable image buffers. */
export async function resolveImages(
    userId: string,
    ids: string[],
): Promise<ResolvedImage[]> {
    const objectIds = ids
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));
    if (!objectIds.length) return [];

    const docs = await uploads()
        .find({ _id: { $in: objectIds }, userId })
        .toArray();

    // Preserve the caller's order.
    const byId = new Map(docs.map((d) => [d._id!.toString(), d]));
    const resolved: ResolvedImage[] = [];
    for (const id of ids) {
        const doc = byId.get(id);
        if (doc) {
            resolved.push({
                data: Buffer.isBuffer(doc.data)
                    ? doc.data
                    : Buffer.from(doc.data as any),
                filename: doc.filename,
                contentType: doc.contentType,
            });
        }
    }
    return resolved;
}
