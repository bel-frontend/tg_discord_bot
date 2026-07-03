import { useEffect, useMemo, useState } from 'react';
import type { MemberPermissions, MemberSummary } from '../../../shared/types';
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
import { PageLayout } from '../layouts/PageLayout';

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
    channelOptions: { id: string; name: string; platform: string }[];
}

function PermissionsForm({
    permissions,
    onChange,
    channelOptions,
}: PermissionsFormProps) {
    const allChannels = permissions.channelAccess === 'all';
    const selected = new Set(
        allChannels ? [] : (permissions.channelAccess as string[]),
    );

    function toggleChannel(id: string) {
        const current = allChannels ? [] : (permissions.channelAccess as string[]);
        const next = current.includes(id)
            ? current.filter((c) => c !== id)
            : [...current, id];
        onChange({ ...permissions, channelAccess: next });
    }

    return (
        <div className="settings-form-fields">
            <label>
                <span>Channel access</span>
                <select
                    value={allChannels ? 'all' : 'specific'}
                    onChange={(e) =>
                        onChange({
                            ...permissions,
                            channelAccess:
                                e.target.value === 'all' ? 'all' : [],
                        })
                    }
                >
                    <option value="all">All channels</option>
                    <option value="specific">Specific channels</option>
                </select>
            </label>

            {!allChannels && (
                <div className="channels">
                    <div className="chan-items">
                        {channelOptions.length === 0 ? (
                            <p className="muted">No resources configured yet.</p>
                        ) : (
                            channelOptions.map((ch) => (
                                <label
                                    key={ch.id}
                                    className={`chip ${
                                        selected.has(ch.id) ? 'selected' : ''
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.has(ch.id)}
                                        onChange={() => toggleChannel(ch.id)}
                                    />
                                    <span>{ch.name}</span>
                                </label>
                            ))
                        )}
                    </div>
                </div>
            )}

            <label>
                <span className="permission-checkbox">
                    <input
                        type="checkbox"
                        checked={permissions.canPublish}
                        onChange={(e) =>
                            onChange({
                                ...permissions,
                                canPublish: e.target.checked,
                            })
                        }
                    />
                    Can publish / schedule
                </span>
            </label>
            <label>
                <span className="permission-checkbox">
                    <input
                        type="checkbox"
                        checked={permissions.canDelete}
                        onChange={(e) =>
                            onChange({
                                ...permissions,
                                canDelete: e.target.checked,
                            })
                        }
                    />
                    Can delete publications / cancel scheduled
                </span>
            </label>
            <label>
                <span className="permission-checkbox">
                    <input
                        type="checkbox"
                        checked={permissions.canManageChannels}
                        onChange={(e) =>
                            onChange({
                                ...permissions,
                                canManageChannels: e.target.checked,
                            })
                        }
                    />
                    Can manage channels &amp; platform settings
                </span>
            </label>
            <label>
                <span className="permission-checkbox">
                    <input
                        type="checkbox"
                        checked={permissions.canManageMembers}
                        onChange={(e) =>
                            onChange({
                                ...permissions,
                                canManageMembers: e.target.checked,
                            })
                        }
                    />
                    Can manage members
                </span>
            </label>
        </div>
    );
}

export function MembersPage() {
    const toast = useToast();
    const me = useMe();
    const { channels, loadChannels } = useChannels();
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

    const channelOptions = useMemo(
        () =>
            channels
                .filter((ch) => ch.resourceId)
                .map((ch) => ({
                    id: ch.resourceId as string,
                    name: ch.name,
                    platform: ch.platform,
                })),
        [channels],
    );

    useEffect(() => {
        if (!canManageMembers) return;
        setLoading(true);
        Promise.all([fetchMembers(), loadChannels()])
            .then(([list]) => setMembers(list))
            .catch((err) => toast(err.message, 'error'))
            .finally(() => setLoading(false));
    }, [canManageMembers, loadChannels, toast]);

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
            <PageLayout className="resource-page">
                <section className="resource-panel">
                    <h2>Members</h2>
                    <p className="muted">
                        You don't have permission to manage members.
                    </p>
                </section>
            </PageLayout>
        );
    }

    return (
        <PageLayout className="resource-page">
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
                        channelOptions={channelOptions}
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
                                                channelOptions={channelOptions}
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
        </PageLayout>
    );
}
