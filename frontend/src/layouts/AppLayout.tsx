import { useState, type ReactNode } from 'react';
import type { User } from '../../../shared/types';
import { resendVerificationEmail } from '../api';
import { useToast } from '../toast';

export interface AppLayoutNavItem {
    label: string;
    onClick: () => void;
    active?: boolean;
}

interface Props {
    title: string;
    user: User;
    theme: 'dark' | 'light';
    navItems?: AppLayoutNavItem[];
    children: ReactNode;
    onToggleTheme: () => void;
    onLogout: () => void;
    emailVerified?: boolean;
}

export function AppLayout({
    title,
    user,
    theme,
    navItems = [],
    children,
    onToggleTheme,
    onLogout,
    emailVerified,
}: Props) {
    const toast = useToast();
    const [resending, setResending] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    async function resendVerification() {
        setResending(true);
        try {
            await resendVerificationEmail();
            toast('Verification email sent', 'success');
        } catch (err: any) {
            toast(err.message, 'error');
        } finally {
            setResending(false);
        }
    }

    return (
        <div className="app">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">✦</span>
                    <span className="brand-name">{title}</span>
                </div>
                <div className="topbar-right">
                    {navItems.map((item) => (
                        <button
                            key={item.label}
                            className={`btn ghost ${
                                item.active ? 'active' : ''
                            }`}
                            aria-current={item.active ? 'page' : undefined}
                            onClick={item.onClick}
                        >
                            {item.label}
                        </button>
                    ))}
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

            {emailVerified === false && !dismissed && (
                <div className="verify-banner">
                    <span>
                        Verify your email to unlock inviting teammates.
                    </span>
                    <div className="verify-banner-actions">
                        <button
                            className="btn small"
                            disabled={resending}
                            onClick={resendVerification}
                        >
                            Resend verification email
                        </button>
                        <button
                            className="btn ghost small"
                            onClick={() => setDismissed(true)}
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            {children}
        </div>
    );
}
