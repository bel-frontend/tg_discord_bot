import { useEffect, useState } from 'react';
import type {
    ChannelOption,
    MemberPermissions,
    MemberSummary,
    PlatformMeta,
} from '../../../shared/types';
import {
    fetchMembers,
    inviteMember,
    resendMemberInvite,
    revokeMember,
    updateMember,
} from '../api';
import { useToast } from '../toast';
import { useMe } from '../meContext';
import { useChannels } from '../hooks/useChannels';
import { usePlatforms } from '../hooks/usePlatforms';
import { platformIcon } from './ChannelPicker';

function emptyPermissions(): MemberPermissions {
    return {
        channelAccess: 'all',
        canPublish: true,
        canDelete: false,
        canManageChannels: false,
        canManageMembers: false,
    };
}

function permissionsSummary(permissions: MemberPermissions): string {
    const parts: string[] = [];
    parts.push(
        permissions.channelAccess === 'all'
            ? 'All channels'
            : `${permissions.channelAccess.length} channel(s)`,
    );
    const abilities: string[] = [];
    if (permissions.canPublish) abilities.push('Publish');
    if (permissions.canDelete) abilities.push('Delete');
    if (permissions.canManageChannels) abilities.push('Manage channels');
    if (permissions.canManageMembers) abilities.push('Manage members');
    parts.push(abilities.length ? abilities.join(', ') : 'No abilities');
    return parts.join(' · ');
}

function statusTone(status: MemberSummary['status']): 'ok' | 'partial' | 'fail' {
    if (status === 'active') return 'ok';
    if (status === 'invited') return 'partial';
    return 'fail';
}

interface PermissionsFormProps {
    permissions: MemberPermissions;
    onChange: (next: MemberPermissions) => void;
    channels: ChannelOption[];
    platforms: PlatformMeta[];
}

interface ChannelAccessPickerProps {
    channelAccess: 'all' | string[];
    onChange: (next: 'all' | string[]) => void;
    channels: ChannelOption[];
    platforms: PlatformMeta[];
}

function ChannelAccessPicker({
    channelAccess,
    onChange,
    channels,
    platforms,
}: ChannelAccessPickerProps) {
    const allChannels = channelAccess === 'all';
    const selectedIds = new Set(allChannels ? [] : channelAccess);

    const groups = new Map<string, { name: string; items: ChannelOption[] }>();
    for (const ch of channels) {
        if (!ch.resourceId) continue;
        const group = groups.get(ch.platform) ?? {
            name: ch.platformName,
            items: [],
        };
        group.items.push(ch);
        groups.set(ch.platform, group);
    }

    function toggleChannel(resourceId: string) {
        const current = allChannels ? [] : channelAccess;
        onChange(
            current.includes(resourceId)
                ? current.filter((id) => id !== resourceId)
                : [...current, resourceId],
        );
    }

    function toggleGroup(items: ChannelOption[]) {
        const ids = items.map((ch) => ch.resourceId as string);
        const current = allChannels ? [] : channelAccess;
        const allOn = ids.every((id) => current.includes(id));
        onChange(
            allOn
                ? current.filter((id) => !ids.includes(id))
                : [...new Set([...current, ...ids])],
        );
    }

    return (
        <div className="channel-access">
            <div className="permission-list">
                <label className="permission-row">
                    <span className="permission-row-text">
                        <span className="permission-row-title">
                            All channels
                        </span>
                        <span className="permission-row-desc">
                            Access to every channel, including ones added
                            later.
                        </span>
                    </span>
                    <input
                        type="checkbox"
                        className="switch"
                        checked={allChannels}
                        onChange={(e) =>
                            onChange(e.target.checked ? 'all' : [])
                        }
                    />
                </label>
            </div>

            {!allChannels && (
                <div className="channels">
                    {groups.size === 0 ? (
                        <p className="muted">No resources configured yet.</p>
                    ) : (
                        [...groups.entries()].map(([platform, group]) => (
                            <div className="chan-group" key={platform}>
                                <div className="chan-group-head">
                                    <span className="chan-plat">
                                        {platformIcon(platform, platforms)}{' '}
                                        {group.name}
                                    </span>
                                    <button
                                        type="button"
                                        className="chan-all btn small"
                                        onClick={() => toggleGroup(group.items)}
                                    >
                                        All
                                    </button>
                                </div>
                                <div className="chan-items">
                                    {group.items.map((ch) => {
                                        const checked = selectedIds.has(
                                            ch.resourceId as string,
                                        );
                                        return (
                                            <label
                                                key={ch.resourceId}
                                                className={`chip ${
                                                    checked ? 'selected' : ''
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() =>
                                                        toggleChannel(
                                                            ch.resourceId as string,
                                                        )
                                                    }
                                                />
                                                <span>{ch.name}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

interface PermissionToggleDef {
    key: 'canPublish' | 'canDelete' | 'canManageChannels' | 'canManageMembers';
    title: string;
    description: string;
}

const PERMISSION_TOGGLES: PermissionToggleDef[] = [
    {
        key: 'canPublish',
        title: 'Publish & schedule',
        description: 'Post to allowed channels and queue scheduled posts.',
    },
    {
        key: 'canDelete',
        title: 'Delete publications',
        description: 'Delete published posts and cancel scheduled ones.',
    },
    {
        key: 'canManageChannels',
        title: 'Manage channels & platforms',
        description: 'Add or remove channels and edit bot credentials.',
    },
    {
        key: 'canManageMembers',
        title: 'Manage members',
        description: 'Invite, edit, and revoke other teammates.',
    },
];

function PermissionsForm({
    permissions,
    onChange,
    channels,
    platforms,
}: PermissionsFormProps) {
    return (
        <div className="permissions-form">
            <div className="field">
                <span className="field-label">Channel access</span>
                <ChannelAccessPicker
                    channelAccess={permissions.channelAccess}
                    onChange={(channelAccess) =>
                        onChange({ ...permissions, channelAccess })
                    }
                    channels={channels}
                    platforms={platforms}
                />
            </div>

            <div className="field">
                <span className="field-label">Permissions</span>
                <div className="permission-list">
                    {PERMISSION_TOGGLES.map((toggle) => (
                        <label className="permission-row" key={toggle.key}>
                            <span className="permission-row-text">
                                <span className="permission-row-title">
                                    {toggle.title}
                                </span>
                                <span className="permission-row-desc">
                                    {toggle.description}
                                </span>
                            </span>
                            <input
                                type="checkbox"
                                className="switch"
                                checked={permissions[toggle.key]}
                                onChange={(e) =>
                                    onChange({
                                        ...permissions,
                                        [toggle.key]: e.target.checked,
                                    })
                                }
                            />
                        </label>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function MembersPanel() {
    const toast = useToast();
    const me = useMe();
    const { channels, loadChannels } = useChannels();
    const { platforms, loadPlatforms } = usePlatforms();
    const [members, setMembers] = useState<MemberSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [email, setEmail] = useState('');
    const [permissions, setPermissions] = useState<MemberPermissions>(
        emptyPermissions,
    );
    const [inviting, setInviting] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingPermissions, setEditingPermissions] =
        useState<MemberPermissions | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const canManageMembers =
        me?.role === 'owner' || me?.permissions.canManageMembers === true;

    useEffect(() => {
        if (!canManageMembers) return;
        setLoading(true);
        Promise.all([fetchMembers(), loadChannels(), loadPlatforms()])
            .then(([list]) => setMembers(list))
            .catch((err) => toast(err.message, 'error'))
            .finally(() => setLoading(false));
    }, [canManageMembers, loadChannels, loadPlatforms, toast]);

    async function submitInvite(e: React.FormEvent) {
        e.preventDefault();
        setInviting(true);
        try {
            const member = await inviteMember(email, permissions);
            setMembers((current) => [...current, member]);
            setEmail('');
            setPermissions(emptyPermissions());
            toast('Invite sent', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setInviting(false);
        }
    }

    function startEdit(member: MemberSummary) {
        setEditingId(member.id);
        setEditingPermissions(member.permissions);
    }

    function cancelEdit() {
        setEditingId(null);
        setEditingPermissions(null);
    }

    async function saveEdit(id: string) {
        if (!editingPermissions) return;
        setBusyId(id);
        try {
            const member = await updateMember(id, editingPermissions);
            setMembers((current) =>
                current.map((m) => (m.id === id ? member : m)),
            );
            cancelEdit();
            toast('Member updated', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setBusyId(null);
        }
    }

    async function revoke(member: MemberSummary) {
        if (!confirm(`Revoke access for ${member.email}?`)) return;
        setBusyId(member.id);
        try {
            await revokeMember(member.id);
            setMembers((current) =>
                current.map((m) =>
                    m.id === member.id ? { ...m, status: 'revoked' } : m,
                ),
            );
            toast('Member revoked', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setBusyId(null);
        }
    }

    async function resend(member: MemberSummary) {
        setBusyId(member.id);
        try {
            const updated = await resendMemberInvite(member.id);
            setMembers((current) =>
                current.map((m) => (m.id === member.id ? updated : m)),
            );
            toast('Invite resent', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setBusyId(null);
        }
    }

    if (!canManageMembers) {
        return (
            <section className="resource-panel">
                <h2>Members</h2>
                <p className="muted">
                    You don't have permission to manage members.
                </p>
            </section>
        );
    }

    return (
        <>
            <section className="resource-panel">
                <h2>Invite a teammate</h2>
                <p className="muted">
                    Invite people to your workspace and control exactly what
                    they can do.
                </p>

                <form className="settings-form" onSubmit={submitInvite}>
                    <div className="settings-form-fields">
                        <label>
                            <span>Email</span>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </label>
                    </div>
                    <PermissionsForm
                        permissions={permissions}
                        onChange={setPermissions}
                        channels={channels}
                        platforms={platforms}
                    />
                    <div className="settings-form-actions">
                        <button className="btn primary" disabled={inviting}>
                            Send invite
                        </button>
                    </div>
                </form>
            </section>

            <section className="resource-panel">
                <h2>Members</h2>
                {loading ? (
                    <p className="muted">Loading…</p>
                ) : members.length === 0 ? (
                    <p className="muted">No members yet.</p>
                ) : (
                    <div className="resource-list">
                        {members.map((member) => (
                            <div className="resource-row" key={member.id}>
                                {editingId === member.id ? (
                                    <div className="member-edit">
                                        <div>
                                            <div className="resource-name">
                                                {member.email}
                                            </div>
                                            <PermissionsForm
                                                permissions={
                                                    editingPermissions ??
                                                    emptyPermissions()
                                                }
                                                onChange={setEditingPermissions}
                                                channels={channels}
                                                platforms={platforms}
                                            />
                                        </div>
                                        <div className="member-edit-actions">
                                            <button
                                                className="btn primary small"
                                                disabled={busyId === member.id}
                                                onClick={() =>
                                                    saveEdit(member.id)
                                                }
                                            >
                                                Save
                                            </button>
                                            <button
                                                className="btn ghost small"
                                                onClick={cancelEdit}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div>
                                            <div className="resource-name">
                                                {member.email}{' '}
                                                <span
                                                    className={`status-pill ${statusTone(
                                                        member.status,
                                                    )}`}
                                                >
                                                    {member.status}
                                                </span>
                                            </div>
                                            <div className="resource-meta">
                                                {permissionsSummary(
                                                    member.permissions,
                                                )}
                                            </div>
                                        </div>
                                        {member.status !== 'revoked' && (
                                            <div className="member-row-actions">
                                                <button
                                                    className="btn small"
                                                    onClick={() =>
                                                        startEdit(member)
                                                    }
                                                >
                                                    Edit
                                                </button>
                                                {member.status ===
                                                    'invited' && (
                                                    <button
                                                        className="btn small"
                                                        disabled={
                                                            busyId ===
                                                            member.id
                                                        }
                                                        onClick={() =>
                                                            resend(member)
                                                        }
                                                    >
                                                        Resend
                                                    </button>
                                                )}
                                                <button
                                                    className="btn small danger"
                                                    disabled={
                                                        busyId === member.id
                                                    }
                                                    onClick={() =>
                                                        revoke(member)
                                                    }
                                                >
                                                    Revoke
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </>
    );
}
