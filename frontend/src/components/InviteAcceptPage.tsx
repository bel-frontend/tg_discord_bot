import { useEffect, useState } from 'react';
import { acceptInvite, fetchInvite, setToken } from '../api';

interface Props {
    token: string;
    onAccepted: (user: { id: string; email: string }) => void;
}

export function InviteAcceptPage({ token, onAccepted }: Props) {
    const [invite, setInvite] = useState<{
        email: string;
        accountOwnerEmail: string;
        requiresPassword: boolean;
    } | null>(null);
    const [loadError, setLoadError] = useState('');
    const [password, setPassword] = useState('');
    const [submitError, setSubmitError] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchInvite(token)
            .then(({ invite }) => setInvite(invite))
            .catch((err: any) =>
                setLoadError(
                    err.message || 'This invite link is invalid or has expired.',
                ),
            )
            .finally(() => setLoading(false));
    }, [token]);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setSubmitError('');
        setBusy(true);
        try {
            const { token: sessionToken, user } = await acceptInvite(
                token,
                password,
            );
            setToken(sessionToken);
            onAccepted(user);
        } catch (err: any) {
            setSubmitError(err.message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="auth">
            <div className="auth-card">
                <div className="brand">
                    <span className="brand-mark">✦</span>
                    <span className="brand-name">Composer</span>
                </div>

                {loading ? (
                    <p className="muted">Loading invite…</p>
                ) : loadError ? (
                    <p className="error-text">{loadError}</p>
                ) : invite ? (
                    <>
                        <p className="auth-sub">
                            {invite.accountOwnerEmail} invited you to join
                            their Composer workspace.
                        </p>
                        <form className="auth-form" onSubmit={submit}>
                            <label>
                                Email
                                <input
                                    type="email"
                                    value={invite.email}
                                    readOnly
                                    disabled
                                />
                            </label>
                            <label>
                                Password
                                <input
                                    type="password"
                                    autoComplete="new-password"
                                    minLength={6}
                                    required
                                    value={password}
                                    onChange={(e) =>
                                        setPassword(e.target.value)
                                    }
                                />
                            </label>
                            {submitError && (
                                <p className="error-text">{submitError}</p>
                            )}
                            <button
                                type="submit"
                                className="btn primary"
                                disabled={busy}
                            >
                                Accept invite
                            </button>
                        </form>
                    </>
                ) : null}
            </div>
        </section>
    );
}
