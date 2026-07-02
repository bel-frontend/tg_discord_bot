import { useEffect, useState } from 'react';
import { api, clearToken, getToken, setUnauthorizedHandler } from './api';
import { ToastProvider } from './toast';
import { Auth } from './components/Auth';
import { Composer } from './components/Composer';
import { ResourceManager } from './components/ResourceManager';
import { SettingsPage } from './components/SettingsPage';
import { ScheduledQueue } from './components/ScheduledQueue';
import type { User } from '../../shared/types';

type AppRoute = 'composer' | 'resources' | 'scheduled' | 'settings';

function routeFromLocation(): AppRoute {
    if (window.location.pathname === '/resources') return 'resources';
    if (window.location.pathname === '/scheduled') return 'scheduled';
    if (window.location.pathname === '/settings') return 'settings';
    return 'composer';
}

export function App() {
    const [user, setUser] = useState<User | null>(null);
    const [ready, setReady] = useState(false);
    const [theme, setTheme] = useState<'dark' | 'light'>(
        (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
    );
    const [view, setView] = useState<AppRoute>(routeFromLocation);

    // Apply the theme to the document root (drives the CSS variables).
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    // A 401 anywhere clears the session and returns to the auth screen.
    useEffect(() => {
        setUnauthorizedHandler(() => setUser(null));
    }, []);

    // Keep the selected screen in the URL so refresh/back/forward don't reset it.
    useEffect(() => {
        const onPopState = () => setView(routeFromLocation());
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // Resume an existing session on load.
    useEffect(() => {
        (async () => {
            if (getToken()) {
                try {
                    const { user } = await api<{ user: User }>('/api/me');
                    setUser(user);
                } catch {
                    clearToken();
                }
            }
            setReady(true);
        })();
    }, []);

    function logout() {
        clearToken();
        setUser(null);
        navigate('composer');
    }

    function navigate(next: AppRoute) {
        const path =
            next === 'resources'
                ? '/resources'
                : next === 'scheduled'
                  ? '/scheduled'
                  : next === 'settings'
                    ? '/settings'
                  : '/';
        if (window.location.pathname !== path) {
            window.history.pushState({}, '', path);
        }
        setView(next);
    }

    return (
        <ToastProvider>
            {!ready ? null : user && view === 'resources' ? (
                <ResourceManager
                    user={user}
                    theme={theme}
                    onToggleTheme={() =>
                        setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
                    }
                    onBack={() => navigate('composer')}
                    onLogout={logout}
                />
            ) : user && view === 'scheduled' ? (
                <ScheduledQueue
                    user={user}
                    theme={theme}
                    onToggleTheme={() =>
                        setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
                    }
                    onBack={() => navigate('composer')}
                    onLogout={logout}
                />
            ) : user && view === 'settings' ? (
                <SettingsPage
                    user={user}
                    theme={theme}
                    onToggleTheme={() =>
                        setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
                    }
                    onBack={() => navigate('composer')}
                    onManageResources={() => navigate('resources')}
                    onLogout={logout}
                />
            ) : user ? (
                <Composer
                    user={user}
                    theme={theme}
                    onToggleTheme={() =>
                        setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
                    }
                    onManageResources={() => navigate('resources')}
                    onOpenScheduled={() => navigate('scheduled')}
                    onOpenSettings={() => navigate('settings')}
                    onLogout={logout}
                />
            ) : (
                <Auth onAuthenticated={setUser} />
            )}
        </ToastProvider>
    );
}
