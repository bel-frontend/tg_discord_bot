import { useState } from 'react';
import { api, setToken } from '../api';
import type { User } from '../../../shared/types';

interface Props {
    onAuthenticated: (user: User) => void;
}

export function Auth({ onAuthenticated }: Props) {
    const [mode, setMode] = useState<'login' | 'register'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    async function submit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
            const path =
                mode === 'login' ? '/api/auth/login' : '/api/auth/register';
            const { token, user } = await api<{ token: string; user: User }>(
                path,
                { method: 'POST', body: { email, password } },
            );
            setToken(token);
            onAuthenticated(user);
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
                <p className="auth-sub">Write once, publish everywhere.</p>

                <div className="tabs">
                    <button
                        className={`tab ${mode === 'login' ? 'active' : ''}`}
                        onClick={() => {
                            setMode('login');
                            setError('');
                        }}
                    >
                        Log in
                    </button>
                    <button
                        className={`tab ${mode === 'register' ? 'active' : ''}`}
                        onClick={() => {
                            setMode('register');
                            setError('');
                        }}
                    >
                        Register
                    </button>
                </div>

                <form className="auth-form" onSubmit={submit}>
                    <label>
                        Email
                        <input
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </label>
                    <label>
                        Password
                        <input
                            type="password"
                            autoComplete={
                                mode === 'login'
                                    ? 'current-password'
                                    : 'new-password'
                            }
                            minLength={6}
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </label>
                    {error && <p className="error-text">{error}</p>}
                    <button
                        type="submit"
                        className="btn primary"
                        disabled={busy}
                    >
                        {mode === 'login' ? 'Log in' : 'Create account'}
                    </button>
                </form>
            </div>
        </section>
    );
}
