import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
    PlatformConfigField,
    PlatformConfigStatus,
} from '../../../shared/types';
import {
    clearPlatformConfigField,
    fetchPlatformConfigs,
    savePlatformConfig,
    startThreadsOAuth,
} from '../api';
import { useToast } from '../toast';
import { usePlatforms } from '../hooks/usePlatforms';
import { PageLayout } from '../layouts/PageLayout';

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

interface ConfigFieldRowProps {
    field: PlatformConfigField;
    value: string;
    saved: boolean;
    editing: boolean;
    clearing: boolean;
    onChange: (value: string) => void;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onRemove: () => void;
}

/**
 * A saved secret can't be shown or edited in place (the server never sends it back), so it
 * gets a "Configured" status row with Change/Remove instead of an empty input pretending to
 * hold a value. Non-secret fields always show their real value in a plain, always-editable input.
 */
function ConfigFieldRow({
    field,
    value,
    saved,
    editing,
    clearing,
    onChange,
    onStartEdit,
    onCancelEdit,
    onRemove,
}: ConfigFieldRowProps) {
    const showInput = !field.secret || !saved || editing;
    return (
        <label>
            <span>
                {field.label}
                {field.required && ' *'}
            </span>
            {showInput ? (
                <>
                    <input
                        type={field.secret ? 'password' : 'text'}
                        autoFocus={editing}
                        required={field.required && (!field.secret || !saved)}
                        placeholder={field.placeholder}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                    />
                    {field.secret && saved && editing && (
                        <button
                            type="button"
                            className="settings-field-cancel"
                            onClick={onCancelEdit}
                        >
                            Cancel
                        </button>
                    )}
                </>
            ) : (
                <div className="settings-field-configured">
                    <span className="settings-field-configured-status">
                        ✓ Configured
                    </span>
                    <div className="settings-field-configured-actions">
                        <button type="button" onClick={onStartEdit}>
                            Change
                        </button>
                        <button
                            type="button"
                            className="settings-field-action-danger"
                            disabled={clearing}
                            onClick={onRemove}
                        >
                            Remove
                        </button>
                    </div>
                </div>
            )}
            <small>{field.description}</small>
        </label>
    );
}

export function SettingsPage() {
    const toast = useToast();
    const { platforms, loadPlatforms } = usePlatforms();
    const [configs, setConfigs] = useState<PlatformConfigStatus[]>([]);
    const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>(
        {},
    );
    const [saving, setSaving] = useState<string | null>(null);
    const [clearing, setClearing] = useState<string | null>(null);
    const [connectingThreads, setConnectingThreads] = useState(false);
    const [editingFields, setEditingFields] = useState<Set<string>>(
        new Set(),
    );
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

    function startEditingField(platform: string, fieldName: string) {
        setEditingFields((current) =>
            new Set(current).add(`${platform}:${fieldName}`),
        );
    }

    function cancelEditingField(platform: string, fieldName: string) {
        setEditingFields((current) => {
            const next = new Set(current);
            next.delete(`${platform}:${fieldName}`);
            return next;
        });
        updateDraft(platform, fieldName, '');
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
            // Every field of this platform is back to its persisted state, so
            // collapse any "Change" input back to the configured/saved view.
            setEditingFields((current) => {
                const prefix = `${platform}:`;
                const next = new Set(
                    [...current].filter((key) => !key.startsWith(prefix)),
                );
                return next;
            });
            toast('Platform settings saved', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setSaving(null);
        }
    }

    async function clearField(platform: string, fieldName: string, fieldLabel: string) {
        if (!confirm(`Remove the saved "${fieldLabel}"?`)) return;
        const key = `${platform}:${fieldName}`;
        setClearing(key);
        try {
            const config = await clearPlatformConfigField(platform, fieldName);
            setConfigs((current) => [
                ...current.filter((item) => item.platform !== platform),
                config,
            ]);
            setDrafts((current) => ({
                ...current,
                [platform]: { ...(current[platform] ?? {}), [fieldName]: '' },
            }));
            setEditingFields((current) => {
                const next = new Set(current);
                next.delete(key);
                return next;
            });
            toast(`${fieldLabel} removed`, 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setClearing(null);
        }
    }

    async function connectThreads() {
        setConnectingThreads(true);
        try {
            const { authUrl } = await startThreadsOAuth();
            window.location.href = authUrl;
        } catch (err: any) {
            toast(err.message, 'error');
            setConnectingThreads(false);
        }
    }

    return (
        <PageLayout className="settings-page">
                <section className="settings-intro">
                    <h2>Platform setup</h2>
                    <p className="muted">
                        Save your platform credentials here, then add the
                        channels, groups, servers, or profiles you want to
                        publish to on the Resources page.
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
                                                            const fieldKey = `${activePlatform.id}:${field.name}`;
                                                            return (
                                                                <ConfigFieldRow
                                                                    key={
                                                                        field.name
                                                                    }
                                                                    field={field}
                                                                    value={
                                                                        drafts[
                                                                            activePlatform
                                                                                .id
                                                                        ]?.[
                                                                            field
                                                                                .name
                                                                        ] ?? ''
                                                                    }
                                                                    saved={saved}
                                                                    editing={editingFields.has(
                                                                        fieldKey,
                                                                    )}
                                                                    clearing={
                                                                        clearing ===
                                                                        fieldKey
                                                                    }
                                                                    onChange={(
                                                                        value,
                                                                    ) =>
                                                                        updateDraft(
                                                                            activePlatform.id,
                                                                            field.name,
                                                                            value,
                                                                        )
                                                                    }
                                                                    onStartEdit={() =>
                                                                        startEditingField(
                                                                            activePlatform.id,
                                                                            field.name,
                                                                        )
                                                                    }
                                                                    onCancelEdit={() =>
                                                                        cancelEditingField(
                                                                            activePlatform.id,
                                                                            field.name,
                                                                        )
                                                                    }
                                                                    onRemove={() =>
                                                                        clearField(
                                                                            activePlatform.id,
                                                                            field.name,
                                                                            field.label,
                                                                        )
                                                                    }
                                                                />
                                                            );
                                                        },
                                                    )}
                                                </div>
                                                <div className="settings-form-actions">
                                                    <button
                                                        className="btn primary"
                                                        disabled={
                                                            saving ===
                                                            activePlatform.id
                                                        }
                                                    >
                                                        Save{' '}
                                                        {activePlatform.name}
                                                    </button>
                                                    {activePlatform.id ===
                                                        'threads' && (
                                                        <button
                                                            type="button"
                                                            className="btn ghost"
                                                            disabled={
                                                                connectingThreads
                                                            }
                                                            onClick={
                                                                connectThreads
                                                            }
                                                        >
                                                            Connect Threads
                                                        </button>
                                                    )}
                                                </div>
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
        </PageLayout>
    );
}
