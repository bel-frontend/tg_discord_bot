import type { ChannelOption, Publication } from '../../../shared/types';
import { findChannelName } from '../lib/channels';
import { buildMessageUrl } from '../lib/messageLinks';
import { platformIcon } from './ChannelPicker';

interface Props {
    publications: Publication[];
    channels: ChannelOption[];
    publishing: boolean;
    highlightedPublicationId: string | null;
    onUpdate: (publication: Publication) => void;
    onDelete: (publication: Publication) => void;
}

export function PublishedTab({
    publications,
    channels,
    publishing,
    highlightedPublicationId,
    onUpdate,
    onDelete,
}: Props) {
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
                        return (
                            <div
                                className={`pub-card ${
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
                                    <div className="pub-card-actions">
                                        <button
                                            className="btn small"
                                            disabled={publishing}
                                            onClick={() => onUpdate(publication)}
                                        >
                                            Update
                                        </button>
                                        <button
                                            className="btn small danger"
                                            disabled={publishing}
                                            onClick={() => onDelete(publication)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                                <div className="pub-targets">
                                    {publication.targets.map((target) => {
                                        const name = findChannelName(
                                            channels,
                                            target.platform,
                                            target.channelId,
                                        );
                                        const url = buildMessageUrl(
                                            target,
                                            channels,
                                        );
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
