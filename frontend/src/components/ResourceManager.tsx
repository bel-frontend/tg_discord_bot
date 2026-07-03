import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useToast } from '../toast';
import type { ChannelOption } from '../../../shared/types';
import { platformIcon } from './ChannelPicker';
import { useChannels } from '../hooks/useChannels';
import { usePlatforms } from '../hooks/usePlatforms';
import { PageLayout } from '../layouts/PageLayout';

// Fallback platform names for ids without a registered adapter yet — lets users
// pre-provision channel resources before the platform module exists.
const PLATFORM_PLACEHOLDERS = [
    { id: 'telegram', name: 'Telegram' },
    { id: 'discord', name: 'Discord' },
    { id: 'threads', name: 'Threads' },
    { id: 'mastodon', name: 'Mastodon' },
    { id: 'bluesky', name: 'Bluesky' },
    { id: 'other', name: 'Other' },
];

export function ResourceManager() {
    const toast = useToast();
    const { channels, loadChannels } = useChannels();
    const { platforms, loadPlatforms } = usePlatforms();
    const [platform, setPlatform] = useState('telegram');
    const [name, setName] = useState('');
    const [channelId, setChannelId] = useState('');
    const [busy, setBusy] = useState(false);

    const platformOptions = useMemo(() => {
        const known = new Map(PLATFORM_PLACEHOLDERS.map((p) => [p.id, p]));
        for (const p of platforms) known.set(p.id, { id: p.id, name: p.name });
        return [...known.values()];
    }, [platforms]);

    useEffect(() => {
        Promise.all([loadChannels(), loadPlatforms()]).catch((err) =>
            toast(err.message, 'error'),
        );
    }, []);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setBusy(true);
        try {
            await api('/api/channels', {
                method: 'POST',
                body: { platform, name, channelId },
            });
            setName('');
            setChannelId('');
            await loadChannels();
            toast('Resource saved', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    async function remove(channel: ChannelOption) {
        if (!channel.resourceId) return;
        if (!confirm(`Delete "${channel.name}"?`)) return;

        try {
            await api(`/api/channels/${channel.resourceId}`, {
                method: 'DELETE',
            });
            await loadChannels();
            toast('Resource deleted', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        }
    }

    return (
        <PageLayout className="resource-page">
                <section className="resource-panel">
                    <h2>Manage publishing resources</h2>
                    <p className="muted">
                        Add the channels, groups, servers, or profiles you want to
                        publish to. Platform credentials (bot tokens, access
                        tokens) are entered separately on the Settings page.
                    </p>

                    <form className="resource-form" onSubmit={submit}>
                        <label>
                            Resource
                            <select
                                value={platform}
                                onChange={(e) => setPlatform(e.target.value)}
                            >
                                {platformOptions.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            Channel name
                            <input
                                type="text"
                                placeholder="Announcements"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </label>
                        <label>
                            Channel ID / username
                            <input
                                type="text"
                                placeholder="@channel or 1374368491771002970"
                                value={channelId}
                                onChange={(e) => setChannelId(e.target.value)}
                                required
                            />
                        </label>
                        <button className="btn primary" disabled={busy}>
                            Add resource
                        </button>
                    </form>

                    <div className="resource-list">
                        {channels.map((channel) => (
                            <div
                                className="resource-row"
                                key={`${channel.platform}:${channel.id}`}
                            >
                                <div>
                                    <div className="resource-name">
                                        {platformIcon(
                                            channel.platform,
                                            platforms,
                                        )}{' '}
                                        {channel.name}
                                    </div>
                                    <div className="resource-meta">
                                        {channel.platform} · {channel.id}
                                        {channel.source === 'config' &&
                                            ' · server default'}
                                    </div>
                                </div>
                                {channel.resourceId ? (
                                    <button
                                        className="btn danger"
                                        onClick={() => remove(channel)}
                                    >
                                        Delete
                                    </button>
                                ) : (
                                    <span className="resource-readonly">
                                        read-only
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
        </PageLayout>
    );
}
