import { useEffect } from 'react';
import type { User } from '../../../shared/types';
import { useToast } from '../toast';
import { usePlatforms } from '../hooks/usePlatforms';

interface Props {
    user: User;
    theme: 'dark' | 'light';
    onToggleTheme: () => void;
    onBack: () => void;
    onManageResources: () => void;
    onLogout: () => void;
}

export function SettingsPage({
    user,
    theme,
    onToggleTheme,
    onBack,
    onManageResources,
    onLogout,
}: Props) {
    const toast = useToast();
    const { platforms, loadPlatforms } = usePlatforms();

    useEffect(() => {
        loadPlatforms().catch((err) => toast(err.message, 'error'));
    }, [loadPlatforms, toast]);

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">✦</span>
                    <span className="brand-name">Settings</span>
                </div>
                <div className="topbar-right">
                    <button className="btn ghost" onClick={onBack}>
                        Back to composer
                    </button>
                    <button className="btn ghost" onClick={onManageResources}>
                        Resources
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

            <main className="settings-page">
                <section className="settings-intro">
                    <h2>Platform setup</h2>
                    <p className="muted">
                        Tokens live in .env. Publish targets can be added in
                        Resources, environment variables, or channels.json.
                    </p>
                </section>

                <section className="settings-platforms">
                    {platforms.map((platform) => {
                        const setup = platform.setup;
                        return (
                            <article
                                className="settings-platform"
                                key={platform.id}
                            >
                                <div className="settings-platform-head">
                                    <h3>
                                        <span>{platform.icon ?? '🌐'}</span>
                                        {platform.name}
                                    </h3>
                                    {platform.charLimit && (
                                        <span className="settings-pill">
                                            {platform.charLimit} chars
                                        </span>
                                    )}
                                </div>

                                {setup ? (
                                    <>
                                        <p className="muted">
                                            {setup.summary}
                                        </p>

                                        <div className="settings-grid">
                                            <div>
                                                <h4>Environment</h4>
                                                <ul className="settings-env">
                                                    {setup.env.map((item) => (
                                                        <li key={item.name}>
                                                            <code>
                                                                {item.name}
                                                            </code>
                                                            <span>
                                                                {item.required
                                                                    ? 'required'
                                                                    : 'optional'}
                                                            </span>
                                                            <p>
                                                                {
                                                                    item.description
                                                                }
                                                            </p>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>

                                            <div>
                                                <h4>Resource ID</h4>
                                                <p>
                                                    <strong>
                                                        {
                                                            setup.channelIdLabel
                                                        }
                                                    </strong>
                                                </p>
                                                <p className="muted">
                                                    {setup.channelIdHelp}
                                                </p>
                                            </div>
                                        </div>

                                        <h4>Steps</h4>
                                        <ol className="settings-steps">
                                            {setup.steps.map((step) => (
                                                <li key={step}>{step}</li>
                                            ))}
                                        </ol>

                                        {!!setup.notes?.length && (
                                            <>
                                                <h4>Notes</h4>
                                                <ul className="settings-notes">
                                                    {setup.notes.map((note) => (
                                                        <li key={note}>
                                                            {note}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </>
                                        )}

                                        {setup.docsUrl && (
                                            <a
                                                className="settings-doc-link"
                                                href={setup.docsUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                Open official docs
                                            </a>
                                        )}
                                    </>
                                ) : (
                                    <p className="muted">
                                        No setup instructions are registered for
                                        this platform yet.
                                    </p>
                                )}
                            </article>
                        );
                    })}
                </section>
            </main>
        </div>
    );
}
