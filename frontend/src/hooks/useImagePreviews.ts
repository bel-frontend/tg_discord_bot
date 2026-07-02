import { fetchImageObjectUrl } from '../api';
import type { ImageItem } from '../components/ImageUploader';

/** Resolve uploaded image ids to blob-URL previews, preserving order, skipping failures. */
export async function loadImagePreviews(ids: string[]): Promise<ImageItem[]> {
    const items = await Promise.all(
        ids.map(async (id) => {
            try {
                return {
                    id,
                    filename: 'image',
                    previewUrl: await fetchImageObjectUrl(id),
                };
            } catch {
                return null;
            }
        }),
    );
    return items.filter((i): i is ImageItem => i !== null);
}
