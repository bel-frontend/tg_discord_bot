import { useState } from 'react';
import type {
    ChannelOption,
    PlatformMeta,
    Publication,
    Target,
} from '../../../shared/types';
import { ChannelPicker } from './ChannelPicker';
import { ImageUploader, type ImageItem } from './ImageUploader';
import { useMe } from '../meContext';

function defaultScheduledAt(): string {
    const date = new Date(Date.now() + 20 * 60 * 1000);
    const offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

interface Props {
    channels: ChannelOption[];
    platforms: PlatformMeta[];
    targets: Target[];
    onTargetsChange: (next: Target[]) => void;
    images: ImageItem[];
    onImagesChange: (next: ImageItem[]) => void;
    imageUrls: string;
    onImageUrlsChange: (value: string) => void;
    silent: boolean;
    onSilentChange: (value: boolean) => void;
    publications: Publication[];
    publishing: boolean;
    scheduling: boolean;
    onSaveDraft: () => void;
    onPublish: () => void;
    onSchedule: (scheduledAt: string) => Promise<void>;
}

export function ComposerSidebar({
    channels,
    platforms,
    targets,
    onTargetsChange,
    images,
    onImagesChange,
    imageUrls,
    onImageUrlsChange,
    silent,
    onSilentChange,
    publications,
    publishing,
    scheduling,
    onSaveDraft,
    onPublish,
    onSchedule,
}: Props) {
    const me = useMe();
    const canPublish = me?.role === 'owner' || me?.permissions.canPublish === true;
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);

    function openSchedule() {
        setScheduledAt(defaultScheduledAt());
        setScheduleOpen(true);
    }

    async function submitSchedule(e: React.FormEvent) {
        e.preventDefault();
        await onSchedule(new Date(scheduledAt).toISOString());
        setScheduleOpen(false);
    }

    return (
        <aside className="sidebar">
            <h3 className="side-title">Publish to</h3>
            <ChannelPicker
                channels={channels}
                platforms={platforms}
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
                    Creates a separate new post — use the Sent tab to edit
                    what's already published.
                </p>
            )}
            <label>
                <input
                    type="checkbox"
                    checked={silent}
                    onChange={(e) => onSilentChange(e.target.checked)}
                />
                {' '}Silent send (no notification)
            </label>

            <div className="actions">
                <button className="btn" onClick={onSaveDraft}>
                    Save draft
                </button>
                {canPublish ? (
                    <>
                        <button
                            className={`btn primary ${publishing ? 'loading' : ''}`}
                            onClick={onPublish}
                            disabled={publishing || targets.length === 0}
                        >
                            {publications.length
                                ? 'Publish as new post'
                                : 'Publish'}
                            {targets.length > 0 && (
                                <span className="count"> ({targets.length})</span>
                            )}
                        </button>
                        <button
                            className={`btn ${scheduling ? 'loading' : ''}`}
                            onClick={openSchedule}
                            disabled={scheduling || targets.length === 0}
                        >
                            Schedule publish
                        </button>
                    </>
                ) : (
                    <p className="muted">
                        You don't have permission to publish in this workspace.
                    </p>
                )}
            </div>

            {scheduleOpen && (
                <div
                    className="modal-backdrop"
                    onClick={() => setScheduleOpen(false)}
                >
                    <form
                        className="schedule-modal"
                        onSubmit={submitSchedule}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3>Schedule publish</h3>
                        <label>
                            Date and time
                            <input
                                type="datetime-local"
                                value={scheduledAt}
                                onChange={(e) => setScheduledAt(e.target.value)}
                                required
                            />
                        </label>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="btn ghost"
                                onClick={() => setScheduleOpen(false)}
                            >
                                Cancel
                            </button>
                            <button className="btn primary" disabled={scheduling}>
                                Schedule
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </aside>
    );
}
