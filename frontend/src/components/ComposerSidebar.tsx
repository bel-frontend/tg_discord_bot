import type {
    ChannelOption,
    Publication,
    PublishResult,
    Target,
} from '../../../shared/types';
import { ChannelPicker } from './ChannelPicker';
import { ImageUploader, type ImageItem } from './ImageUploader';
import { PublishedPanel } from './PublishedPanel';
import { ResultsPanel } from './ResultsPanel';

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
    onUpdatePublished: (publication: Publication) => void;
    onDeletePublished: (publication: Publication) => void;
    onSaveDraft: () => void;
    onPublish: () => void;
    results: PublishResult[] | null;
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
    onUpdatePublished,
    onDeletePublished,
    onSaveDraft,
    onPublish,
    results,
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

            <PublishedPanel
                publications={publications}
                publishing={publishing}
                onUpdate={onUpdatePublished}
                onDelete={onDeletePublished}
            />

            <div className="actions">
                <button className="btn" onClick={onSaveDraft}>
                    Save draft
                </button>
                <button
                    className={`btn primary ${publishing ? 'loading' : ''}`}
                    onClick={onPublish}
                    disabled={publishing || targets.length === 0}
                >
                    {publications.length ? 'Republish as new' : 'Publish'}
                    {targets.length > 0 && (
                        <span className="count"> ({targets.length})</span>
                    )}
                </button>
            </div>

            <ResultsPanel results={results} channels={channels} />
        </aside>
    );
}
