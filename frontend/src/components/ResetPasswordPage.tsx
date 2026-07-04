import { useState } from 'react';
import { resetPassword, setToken } from '../api';
import type { User } from '../../../shared/types';

interface Props {
    token: string;
    onReset: (user: User) => void;
}

export function ResetPasswordPage({ token, onReset }: Props) {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        setBusy(true);
        try {
            const { token: sessionToken, user } = await resetPassword(token, password);
            setToken(sessionToken);
            onReset(user);
        } catch (err: any) {
            setError(err.message);
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
                <p className="auth-sub">Set a new password</p>

                <form className="auth-form" onSubmit={submit}>
                    <label>
                        New password
                        <input
                            type="password"
                            autoComplete="new-password"
                            minLength={6}
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </label>
                    <label>
                        Confirm new password
                        <input
                            type="password"
                            autoComplete="new-password"
                            minLength={6}
                            required
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                    </label>
                    {error && <p className="error-text">{error}</p>}
                    <button type="submit" className="btn primary" disabled={busy}>
                        Reset password
                    </button>
                </form>
            </div>
        </section>
    );
}
