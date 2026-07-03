import type {
    ChannelOption,
    PlatformMeta,
    Publication,
} from '../../../shared/types';
import { findChannelName } from '../lib/channels';
import { platformIcon } from './ChannelPicker';
import { useMe } from '../meContext';

interface Props {
    publications: Publication[];
    channels: ChannelOption[];
    platforms: PlatformMeta[];
    publishing: boolean;
    highlightedPublicationId: string | null;
    onUpdate: (publication: Publication) => void;
    onDelete: (publication: Publication) => void;
}

function publicationStatus(publication: Publication): {
    label: string;
    tone: 'ok' | 'partial' | 'fail';
} {
    const okTargets = publication.targets.filter((target) => target.ok).length;
    if (okTargets === publication.targets.length) {
        return { label: 'Published', tone: 'ok' };
    }
    if (okTargets > 0) return { label: 'Partially published', tone: 'partial' };
    return { label: 'Failed', tone: 'fail' };
}

export function PublishedTab({
    publications,
    channels,
    platforms,
    publishing,
    highlightedPublicationId,
    onUpdate,
    onDelete,
}: Props) {
    const me = useMe();
    const canPublish = me?.role === 'owner' || me?.permissions.canPublish === true;
    const canDelete = me?.role === 'owner' || me?.permissions.canDelete === true;
    return (
        <div className="published-tab">
            {publications.length === 0 ? (
                <p className="muted">
                    Not published yet — select channels and publish from the
                    Edit tab.
                </p>
            ) : (
                <div className="pub-list">
                    {publications.map((publication) => {
                        const okTargets = publication.targets.filter(
                            (target) => target.ok,
                        ).length;
                        const status = publicationStatus(publication);
                        return (
                            <div
                                className={`pub-card ${status.tone} ${
                                    publication.id === highlightedPublicationId
                                        ? 'highlight'
                                        : ''
                                }`}
                                key={publication.id}
                            >
                                <div className="pub-card-head">
                                    <div>
                                        <strong>
                                            {new Date(
                                                publication.updatedAt,
                                            ).toLocaleString()}
                                        </strong>
                                        <span className="muted">
                                            {okTargets}/
                                            {publication.targets.length}{' '}
                                            channels
                                        </span>
                                    </div>
                                    <span
                                        className={`status-pill ${status.tone}`}
                                    >
                                        {status.label}
                                    </span>
                                    <div className="pub-card-actions">
                                        {canPublish && (
                                            <button
                                                className="btn small"
                                                disabled={publishing}
                                                onClick={() => onUpdate(publication)}
                                            >
                                                Update
                                            </button>
                                        )}
                                        {canDelete && (
                                            <button
                                                className="btn small danger"
                                                disabled={publishing}
                                                onClick={() => onDelete(publication)}
                                            >
                                                Delete
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="pub-targets">
                                    {publication.targets.map((target) => {
                                        const name = findChannelName(
                                            channels,
                                            target.platform,
                                            target.channelId,
                                        );
                                        const url = target.link ?? null;
                                        return (
                                            <div
                                                className={`pub-target-row ${
                                                    target.ok ? 'ok' : 'fail'
                                                }`}
                                                key={`${target.platform}:${target.channelId}`}
                                            >
                                                <span className="pub-target-badge">
                                                    {target.ok ? '✓' : '✗'}
                                                </span>
                                                <span className="pub-target-name">
                                                    {platformIcon(
                                                        target.platform,
                                                        platforms,
                                                    )}{' '}
                                                    {name}
                                                </span>
                                                {url && (
                                                    <a
                                                        className="pub-target-link"
                                                        href={url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        Open ↗
                                                    </a>
                                                )}
                                                {!target.ok && (
                                                    <span className="pub-target-err">
                                                        {target.error}
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
