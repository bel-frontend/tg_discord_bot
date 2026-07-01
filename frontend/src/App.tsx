import { useEffect, useState } from 'react';
import { api, clearToken, getToken, setUnauthorizedHandler } from './api';
import { ToastProvider } from './toast';
import { Auth } from './components/Auth';
import { Composer } from './components/Composer';
import type { User } from './types';

export function App() {
    const [user, setUser] = useState<User | null>(null);
    const [ready, setReady] = useState(false);
    const [theme, setTheme] = useState<'dark' | 'light'>(
        (localStorage.getItem('theme') as 'dark' | 'light') || 'dark',
    );

    // Apply the theme to the document root (drives the CSS variables).
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    // A 401 anywhere clears the session and returns to the auth screen.
    useEffect(() => {
        setUnauthorizedHandler(() => setUser(null));
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
    }

    return (
        <ToastProvider>
            {!ready ? null : user ? (
                <Composer
                    user={user}
                    theme={theme}
                    onToggleTheme={() =>
                        setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
                    }
                    onLogout={logout}
                />
            ) : (
                <Auth onAuthenticated={setUser} />
            )}
        </ToastProvider>
    );
}
