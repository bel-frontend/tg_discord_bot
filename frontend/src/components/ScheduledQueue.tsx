import { useEffect, useState } from 'react';
import type {
    Publication,
    ScheduledPublication,
} from '../../../shared/types';
import { useToast } from '../toast';
import { useScheduledPublications } from '../hooks/useScheduledPublications';
import { PageLayout } from '../layouts/PageLayout';

interface Props {
    onOpenDraft: (draftId: string, publicationId?: string) => void;
}

function statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString();
}

interface ScheduledItemProps {
    item: ScheduledPublication;
    onCancel: (id: string) => void;
    onOpenDraft: (draftId: string, publicationId?: string) => void;
}

function ScheduledItem({ item, onCancel, onOpenDraft }: ScheduledItemProps) {
    return (
        <article
            className={`scheduled-row ${item.status}`}
            onClick={() => onOpenDraft(item.draftId, item.publicationId)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenDraft(item.draftId, item.publicationId);
                }
            }}
        >
            <div>
                <strong>{item.title}</strong>
                <div className="resource-meta">
                    {formatDate(item.scheduledAt)} · {statusLabel(item.status)}
                </div>
                {item.error && <p className="scheduled-error">{item.error}</p>}
            </div>
            <div className="scheduled-actions">
                {item.status === 'scheduled' && (
                    <button
                        className="btn danger"
                        onClick={(event) => {
                            event.stopPropagation();
                            onCancel(item.id);
                        }}
                    >
                        Cancel
                    </button>
                )}
            </div>
        </article>
    );
}

interface ArchiveItemProps {
    publication: Publication;
    onOpenDraft: (draftId: string, publicationId?: string) => void;
}

function ArchiveItem({ publication, onOpenDraft }: ArchiveItemProps) {
    const okCount = publication.targets.filter((target) => target.ok).length;
    return (
        <article
            className="scheduled-row published"
            onClick={() => onOpenDraft(publication.draftId, publication.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenDraft(publication.draftId, publication.id);
                }
            }}
        >
            <div>
                <strong>{publication.title}</strong>
                <div className="resource-meta">
                    {formatDate(publication.updatedAt)} · Published · {okCount}/
                    {publication.targets.length} targets
                </div>
            </div>
        </article>
    );
}

export function ScheduledQueue({ onOpenDraft }: Props) {
    const toast = useToast();
    const [activeTab, setActiveTab] = useState<'upcoming' | 'archive'>(
        'upcoming',
    );
    const {
        scheduledPublications,
        publicationArchive,
        loadScheduledPublications,
        cancelScheduledPublication,
    } = useScheduledPublications();

    const upcomingPublications = scheduledPublications.filter((item) =>
        ['scheduled', 'publishing'].includes(item.status),
    );

    useEffect(() => {
        loadScheduledPublications().catch((err) => toast(err.message, 'error'));
    }, [loadScheduledPublications, toast]);

    async function cancel(id: string) {
        try {
            await cancelScheduledPublication(id);
            toast('Scheduled publication cancelled', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        }
    }

    return (
        <PageLayout className="scheduled-page">
            <section className="scheduled-panel">
                <div className="scheduled-head">
                    <h2>Scheduled queue</h2>
                    <button
                        className="btn small"
                        onClick={loadScheduledPublications}
                    >
                        Refresh
                    </button>
                </div>

                <div className="scheduled-tabs">
                    <button
                        type="button"
                        className={`scheduled-tab ${
                            activeTab === 'upcoming' ? 'active' : ''
                        }`}
                        onClick={() => setActiveTab('upcoming')}
                    >
                        Upcoming
                        <span>{upcomingPublications.length}</span>
                    </button>
                    <button
                        type="button"
                        className={`scheduled-tab ${
                            activeTab === 'archive' ? 'active' : ''
                        }`}
                        onClick={() => setActiveTab('archive')}
                    >
                        Archive
                        <span>{publicationArchive.length}</span>
                    </button>
                </div>

                {activeTab === 'upcoming' &&
                upcomingPublications.length === 0 ? (
                    <p className="muted">No upcoming publications.</p>
                ) : activeTab === 'archive' &&
                  publicationArchive.length === 0 ? (
                    <p className="muted">No published publications yet.</p>
                ) : activeTab === 'upcoming' ? (
                    <div className="scheduled-list">
                        {upcomingPublications.map((item) => (
                            <ScheduledItem
                                key={item.id}
                                item={item}
                                onCancel={cancel}
                                onOpenDraft={onOpenDraft}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="scheduled-list">
                        {publicationArchive.map((publication) => (
                            <ArchiveItem
                                key={publication.id}
                                publication={publication}
                                onOpenDraft={onOpenDraft}
                            />
                        ))}
                    </div>
                )}
            </section>
        </PageLayout>
    );
}
