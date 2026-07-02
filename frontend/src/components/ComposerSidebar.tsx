import type { ChannelOption, Publication, Target } from '../../../shared/types';
import { ChannelPicker } from './ChannelPicker';
import { ImageUploader, type ImageItem } from './ImageUploader';

interface Props {
    channels: ChannelOption[];
    targets: Target[];
    onTargetsChange: (next: Target[]) => void;
    images: ImageItem[];
    onImagesChange: (next: ImageItem[]) => void;
    imageUrls: string;
    onImageUrlsChange: (value: string) => void;
    publications: Publication[];
    publishing: boolean;
    onSaveDraft: () => void;
    onPublish: () => void;
}

export function ComposerSidebar({
    channels,
    targets,
    onTargetsChange,
    images,
    onImagesChange,
    imageUrls,
    onImageUrlsChange,
    publications,
    publishing,
    onSaveDraft,
    onPublish,
}: Props) {
    return (
        <aside className="sidebar">
            <h3 className="side-title">Publish to</h3>
            <ChannelPicker
                channels={channels}
                selected={targets}
                onChange={onTargetsChange}
            />

            <ImageUploader images={images} onChange={onImagesChange} />

            <label className="field">
                or image URLs (comma-separated)
                <input
                    type="text"
                    placeholder="https://…"
                    value={imageUrls}
                    onChange={(e) => onImageUrlsChange(e.target.value)}
                />
            </label>

            {publications.length > 0 && (
                <p className="muted">
                    Creates a separate new post — use the Update tab to edit
                    what's already published.
                </p>
            )}
            <div className="actions">
                <button className="btn" onClick={onSaveDraft}>
                    Save draft
                </button>
                <button
                    className={`btn primary ${publishing ? 'loading' : ''}`}
                    onClick={onPublish}
                    disabled={publishing || targets.length === 0}
                >
                    {publications.length ? 'Publish as new post' : 'Publish'}
                    {targets.length > 0 && (
                        <span className="count"> ({targets.length})</span>
                    )}
                </button>
            </div>
        </aside>
    );
}
