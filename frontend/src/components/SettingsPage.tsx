import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlatformConfigStatus, User } from '../../../shared/types';
import { fetchPlatformConfigs, savePlatformConfig } from '../api';
import { useToast } from '../toast';
import { usePlatforms } from '../hooks/usePlatforms';

const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

/** Render "[label](url)" markers inline as real links, so a step/note can link exactly where it's mentioned. */
function linkify(text: string): ReactNode[] {
    const parts: ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    LINK_PATTERN.lastIndex = 0;
    while ((match = LINK_PATTERN.exec(text))) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }
        parts.push(
            <a key={key++} href={match[2]} target="_blank" rel="noreferrer">
                {match[1]}
            </a>,
        );
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
}

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
    const [configs, setConfigs] = useState<PlatformConfigStatus[]>([]);
    const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(
        {},
    );
    const [saving, setSaving] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('');
    const [instructionsOpen, setInstructionsOpen] = useState(false);

    const configByPlatform = useMemo(
        () => new Map(configs.map((config) => [config.platform, config])),
        [configs],
    );

    const activePlatform = platforms.find((p) => p.id === activeTab);

    useEffect(() => {
        if (!activeTab && platforms.length) setActiveTab(platforms[0].id);
    }, [platforms, activeTab]);

    useEffect(() => {
        Promise.all([loadPlatforms(), fetchPlatformConfigs()])
            .then(([, nextConfigs]) => {
                setConfigs(nextConfigs);
                setDrafts(
                    Object.fromEntries(
                        nextConfigs.map((config) => [
                            config.platform,
                            config.values,
                        ]),
                    ),
                );
            })
            .catch((err) => toast(err.message, 'error'));
    }, [loadPlatforms, toast]);

    function updateDraft(platform: string, name: string, value: string) {
        setDrafts((current) => ({
            ...current,
            [platform]: {
                ...(current[platform] ?? {}),
                [name]: value,
            },
        }));
    }

    async function save(platform: string) {
        setSaving(platform);
        try {
            const config = await savePlatformConfig(
                platform,
                drafts[platform] ?? {},
            );
            setConfigs((current) => [
                ...current.filter((item) => item.platform !== platform),
                config,
            ]);
            setDrafts((current) => ({
                ...current,
                [platform]: config.values,
            }));
            toast('Platform settings saved', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setSaving(null);
        }
    }

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
                        Save each user's platform credentials here. Publish
                        targets still live in Resources, environment variables,
                        or channels.json.
                    </p>
                </section>

                {platforms.length === 0 ? (
                    <p className="muted">No platforms are registered.</p>
                ) : (
                    <>
                        <div className="settings-tabs">
                            {platforms.map((platform) => (
                                <button
                                    key={platform.id}
                                    type="button"
                                    className={`settings-tab ${
                                        activeTab === platform.id
                                            ? 'active'
                                            : ''
                                    }`}
                                    onClick={() => setActiveTab(platform.id)}
                                >
                                    <span>{platform.icon ?? '🌐'}</span>{' '}
                                    {platform.name}
                                </button>
                            ))}
                        </div>

                        {activePlatform && (
                            <section
                                className="settings-platform-panel"
                                key={activePlatform.id}
                            >
                                <div className="settings-platform-head">
                                    <h3>
                                        <span>
                                            {activePlatform.icon ?? '🌐'}
                                        </span>
                                        {activePlatform.name}
                                    </h3>
                                    <div className="settings-platform-head-actions">
                                        {activePlatform.charLimit && (
                                            <span className="settings-pill">
                                                {activePlatform.charLimit} chars
                                            </span>
                                        )}
                                        {activePlatform.setup && (
                                            <button
                                                type="button"
                                                className="settings-howto-btn"
                                                onClick={() =>
                                                    setInstructionsOpen(true)
                                                }
                                            >
                                                📖 Setup guide
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {activePlatform.setup ? (
                                    <>
                                        <p className="muted">
                                            {activePlatform.setup.summary}
                                        </p>

                                        {activePlatform.setup.configFields
                                            ?.length ? (
                                            <form
                                                className="settings-form"
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    save(activePlatform.id);
                                                }}
                                            >
                                                <div className="settings-form-fields">
                                                    {activePlatform.setup.configFields.map(
                                                        (field) => {
                                                            const fieldConfig =
                                                                configByPlatform.get(
                                                                    activePlatform.id,
                                                                );
                                                            const saved = field.secret
                                                                ? Boolean(
                                                                      fieldConfig?.configuredSecrets.includes(
                                                                          field.name,
                                                                      ),
                                                                  )
                                                                : Boolean(
                                                                      fieldConfig
                                                                          ?.values[
                                                                          field.name
                                                                      ],
                                                                  );
                                                            return (
                                                                <label
                                                                    key={
                                                                        field.name
                                                                    }
                                                                >
                                                                    <span>
                                                                        {
                                                                            field.label
                                                                        }
                                                                        {field.required &&
                                                                            ' *'}
                                                                        {saved && (
                                                                            <span className="settings-field-saved">
                                                                                Saved
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <input
                                                                        type={
                                                                            field.secret
                                                                                ? 'password'
                                                                                : 'text'
                                                                        }
                                                                        required={
                                                                            field.required &&
                                                                            (!field.secret ||
                                                                                !saved)
                                                                        }
                                                                        placeholder={
                                                                            saved
                                                                                ? 'Saved; leave blank to keep'
                                                                                : field.placeholder
                                                                        }
                                                                        value={
                                                                            drafts[
                                                                                activePlatform
                                                                                    .id
                                                                            ]?.[
                                                                                field
                                                                                    .name
                                                                            ] ??
                                                                            ''
                                                                        }
                                                                        onChange={(
                                                                            event,
                                                                        ) =>
                                                                            updateDraft(
                                                                                activePlatform.id,
                                                                                field.name,
                                                                                event
                                                                                    .target
                                                                                    .value,
                                                                            )
                                                                        }
                                                                    />
                                                                    <small>
                                                                        {
                                                                            field.description
                                                                        }
                                                                    </small>
                                                                </label>
                                                            );
                                                        },
                                                    )}
                                                </div>
                                                <button
                                                    className="btn primary"
                                                    disabled={
                                                        saving ===
                                                        activePlatform.id
                                                    }
                                                >
                                                    Save {activePlatform.name}
                                                </button>
                                            </form>
                                        ) : (
                                            <p className="muted">
                                                This platform has no
                                                user-configurable credentials.
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="muted">
                                        No setup instructions are registered
                                        for this platform yet.
                                    </p>
                                )}
                            </section>
                        )}

                        {instructionsOpen && activePlatform?.setup && (
                            <div
                                className="modal-backdrop"
                                onClick={() => setInstructionsOpen(false)}
                            >
                                <div
                                    className="settings-instructions-modal"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <h3>
                                        {activePlatform.icon ?? '🌐'}{' '}
                                        {activePlatform.name} setup
                                    </h3>

                                    <div className="settings-instructions-body">
                                        <h4>Steps</h4>
                                        <ol className="settings-steps">
                                            {activePlatform.setup.steps.map(
                                                (step) => (
                                                    <li key={step}>
                                                        {linkify(step)}
                                                    </li>
                                                ),
                                            )}
                                        </ol>

                                        <div className="settings-grid">
                                            <div>
                                                <h4>Environment</h4>
                                                <ul className="settings-env">
                                                    {activePlatform.setup.env.map(
                                                        (item) => (
                                                            <li
                                                                key={item.name}
                                                            >
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
                                                        ),
                                                    )}
                                                </ul>
                                            </div>

                                            <div>
                                                <h4>Resource ID</h4>
                                                <p>
                                                    <strong>
                                                        {
                                                            activePlatform.setup
                                                                .channelIdLabel
                                                        }
                                                    </strong>
                                                </p>
                                                <p className="muted">
                                                    {
                                                        activePlatform.setup
                                                            .channelIdHelp
                                                    }
                                                </p>
                                            </div>
                                        </div>

                                        {!!activePlatform.setup.notes
                                            ?.length && (
                                            <>
                                                <h4>Notes</h4>
                                                <ul className="settings-notes">
                                                    {activePlatform.setup.notes.map(
                                                        (note) => (
                                                            <li key={note}>
                                                                {linkify(
                                                                    note,
                                                                )}
                                                            </li>
                                                        ),
                                                    )}
                                                </ul>
                                            </>
                                        )}

                                        {activePlatform.setup.docsUrl && (
                                            <a
                                                className="settings-doc-link"
                                                href={
                                                    activePlatform.setup
                                                        .docsUrl
                                                }
                                                target="_blank"
                                                rel="noreferrer"
                                            >
                                                Open official docs
                                            </a>
                                        )}
                                    </div>

                                    <div className="modal-actions">
                                        <button
                                            type="button"
                                            className="btn ghost"
                                            onClick={() =>
                                                setInstructionsOpen(false)
                                            }
                                        >
                                            Close
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
