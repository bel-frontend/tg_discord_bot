import { useEffect, useState } from 'react';
import { api, clearToken, getToken, setUnauthorizedHandler } from '../api';
import { ToastProvider } from '../toast';
import { Auth } from '../components/Auth';
import { ComposerPage } from '../routes/composer/page';
import { ResourcesPage } from '../routes/resources/page';
import { ScheduledPage } from '../routes/scheduled/page';
import { SettingsPage } from '../routes/settings/page';
import { AppLayout } from '../layouts/AppLayout';
import type { User } from '../../../shared/types';
import { pathForRoute, routeFromPath, type AppRoute } from './routes';
import {
    persistTheme,
    readInitialTheme,
    toggleTheme as getNextTheme,
    type AppTheme,
} from './theme';

export function App() {
    const [user, setUser] = useState<User | null>(null);
    const [ready, setReady] = useState(false);
    const [theme, setTheme] = useState<AppTheme>(readInitialTheme);
    const [view, setView] = useState<AppRoute>(() =>
        routeFromPath(window.location.pathname),
    );

    // Apply the theme to the document root (drives the CSS variables).
    useEffect(() => {
        persistTheme(theme);
    }, [theme]);

    // A 401 anywhere clears the session and returns to the auth screen.
    useEffect(() => {
        setUnauthorizedHandler(() => setUser(null));
    }, []);

    // Keep the selected screen in the URL so refresh/back/forward don't reset it.
    useEffect(() => {
        const onPopState = () =>
            setView(routeFromPath(window.location.pathname));
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

    function toggleTheme() {
        setTheme(getNextTheme);
    }

    function navigate(next: AppRoute) {
        const path = pathForRoute(next);
        if (window.location.pathname !== path) {
            window.history.pushState({}, '', path);
        }
        setView(next);
    }

    function renderPage() {
        if (view === 'resources') return <ResourcesPage />;
        if (view === 'scheduled') return <ScheduledPage />;
        if (view === 'settings') return <SettingsPage />;
        return <ComposerPage theme={theme} />;
    }

    function navItem(route: AppRoute, label: string) {
        return {
            label,
            active: view === route,
            onClick: () => navigate(route),
        };
    }

    return (
        <ToastProvider>
            {!ready ? null : user ? (
                <AppLayout
                    title="Composer"
                    user={user}
                    theme={theme}
                    navItems={[
                        navItem('composer', 'Composer'),
                        navItem('resources', 'Resources'),
                        navItem('scheduled', 'Scheduled'),
                        navItem('settings', 'Settings'),
                    ]}
                    onToggleTheme={toggleTheme}
                    onLogout={logout}
                >
                    {renderPage()}
                </AppLayout>
            ) : (
                <Auth onAuthenticated={setUser} />
            )}
        </ToastProvider>
    );
}
