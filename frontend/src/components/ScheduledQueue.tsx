import { useEffect } from 'react';
import { useToast } from '../toast';
import { useScheduledPublications } from '../hooks/useScheduledPublications';
import { PageLayout } from '../layouts/PageLayout';

function statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

export function ScheduledQueue() {
    const toast = useToast();
    const {
        scheduledPublications,
        loadScheduledPublications,
        cancelScheduledPublication,
    } = useScheduledPublications();

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

                    {scheduledPublications.length === 0 ? (
                        <p className="muted">No scheduled publications.</p>
                    ) : (
                        <div className="scheduled-list">
                            {scheduledPublications.map((item) => (
                                <article
                                    className={`scheduled-row ${item.status}`}
                                    key={item.id}
                                >
                                    <div>
                                        <strong>{item.title}</strong>
                                        <div className="resource-meta">
                                            {new Date(
                                                item.scheduledAt,
                                            ).toLocaleString()}{' '}
                                            · {statusLabel(item.status)}
                                        </div>
                                        {item.error && (
                                            <p className="scheduled-error">
                                                {item.error}
                                            </p>
                                        )}
                                    </div>
                                    <div className="scheduled-actions">
                                        {item.status === 'scheduled' && (
                                            <button
                                                className="btn danger"
                                                onClick={() => cancel(item.id)}
                                            >
                                                Cancel
                                            </button>
                                        )}
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </section>
        </PageLayout>
    );
}
