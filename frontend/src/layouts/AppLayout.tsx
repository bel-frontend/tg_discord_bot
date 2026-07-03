import type { ReactNode } from 'react';
import type { User } from '../../../shared/types';

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
}

export function AppLayout({
    title,
    user,
    theme,
    navItems = [],
    children,
    onToggleTheme,
    onLogout,
}: Props) {
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

            {children}
        </div>
    );
}
