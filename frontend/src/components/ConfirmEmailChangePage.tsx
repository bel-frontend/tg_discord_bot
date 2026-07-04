import { useEffect, useState } from 'react';
import { confirmEmailChange } from '../api';

interface Props {
    token: string;
    onGoToApp: () => void;
}

export function ConfirmEmailChangePage({ token, onGoToApp }: Props) {
    const [status, setStatus] = useState<'pending' | 'ok' | 'error'>(
        'pending',
    );
    const [message, setMessage] = useState('');

    useEffect(() => {
        confirmEmailChange(token)
            .then(({ email }) => {
                setStatus('ok');
                setMessage(`Your account email is now ${email}.`);
            })
            .catch((err: any) => {
                setStatus('error');
                setMessage(
                    err.message ||
                        'This confirmation link is invalid or has expired.',
                );
            });
    }, [token]);

    return (
        <section className="auth">
            <div className="auth-card">
                <div className="brand">
                    <span className="brand-mark">✦</span>
                    <span className="brand-name">Composer</span>
                </div>

                {status === 'pending' && (
                    <p className="muted">Confirming your new email…</p>
                )}
                {status === 'ok' && (
                    <>
                        <p className="auth-sub">Email updated</p>
                        <p className="muted">{message}</p>
                        <button className="btn primary" onClick={onGoToApp}>
                            Continue to Composer
                        </button>
                    </>
                )}
                {status === 'error' && (
                    <>
                        <p className="error-text">{message}</p>
                        <button className="btn ghost" onClick={onGoToApp}>
                            Back to Composer
                        </button>
                    </>
                )}
            </div>
        </section>
    );
}
