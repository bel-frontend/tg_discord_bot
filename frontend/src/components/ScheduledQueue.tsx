import { useEffect } from 'react';
import type { User } from '../../../shared/types';
import { useToast } from '../toast';
import { useScheduledPublications } from '../hooks/useScheduledPublications';

interface Props {
    user: User;
    theme: 'dark' | 'light';
    onToggleTheme: () => void;
    onBack: () => void;
    onLogout: () => void;
}

function statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

export function ScheduledQueue({
    user,
    theme,
    onToggleTheme,
    onBack,
    onLogout,
}: Props) {
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
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">✦</span>
                    <span className="brand-name">Scheduled</span>
                </div>
                <div className="topbar-right">
                    <button className="btn ghost" onClick={onBack}>
                        Back to composer
                    </button>
                    <button
                        className="btn ghost"
                        title="Toggle theme"
                        onClick={onToggleTheme}
                    >
                        {theme === 'dark' ? '◐' : '◑'}
                    </button>
                    <span className="user-email">{user.email}</span>
                    <button className="btn ghost" onClick={onLogout}>
                        Log out
                    </button>
                </div>
            </header>

            <main className="scheduled-page">
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
            </main>
        </div>
    );
}
