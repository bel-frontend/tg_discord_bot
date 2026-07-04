import { useEffect, useState } from 'react';
import { clearToken, fetchMe, getToken, setUnauthorizedHandler } from '../api';
import { ToastProvider } from '../toast';
import { Auth } from '../components/Auth';
import { InviteAcceptPage } from '../components/InviteAcceptPage';
import { VerifyEmailPage } from '../components/VerifyEmailPage';
import { ResetPasswordPage } from '../components/ResetPasswordPage';
import { ConfirmEmailChangePage } from '../components/ConfirmEmailChangePage';
import { ComposerPage } from '../routes/composer/page';
import { ResourcesPage } from '../routes/resources/page';
import { ScheduledPage } from '../routes/scheduled/page';
import { SettingsPage } from '../routes/settings/page';
import { AppLayout } from '../layouts/AppLayout';
import { MeProvider } from '../meContext';
import type { Me, User } from '../../../shared/types';
import {
    confirmEmailChangeTokenFromPath,
    editIdForPublishedOrDraft,
    editIdFromPath,
    inviteTokenFromPath,
    pathForEdit,
    pathForRoute,
    resetPasswordTokenFromPath,
    routeFromPath,
    verifyEmailTokenFromPath,
    type AppRoute,
} from './routes';
import {
    persistTheme,
    readInitialTheme,
    toggleTheme as getNextTheme,
    type AppTheme,
} from './theme';

export function App() {
    const [user, setUser] = useState<User | null>(null);
    const [me, setMe] = useState<Me | null>(null);
    const [ready, setReady] = useState(false);
    const [theme, setTheme] = useState<AppTheme>(readInitialTheme);
    const [view, setView] = useState<AppRoute>(() =>
        routeFromPath(window.location.pathname),
    );
    const [locationPathname, setLocationPathname] = useState(
        window.location.pathname,
    );
    const [locationSearch, setLocationSearch] = useState(
        window.location.search,
    );
    const inviteToken = inviteTokenFromPath(locationPathname);
    const verifyEmailToken = verifyEmailTokenFromPath(locationPathname);
    const resetPasswordToken = resetPasswordTokenFromPath(locationPathname);
    const confirmEmailChangeToken =
        confirmEmailChangeTokenFromPath(locationPathname);

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
        const onPopState = () => {
            setLocationPathname(window.location.pathname);
            setView(routeFromPath(window.location.pathname));
            setLocationSearch(window.location.search);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // Resume an existing session on load.
    useEffect(() => {
        (async () => {
            if (getToken()) {
                try {
                    const me = await fetchMe();
                    setUser(me.user);
                    setMe(me);
                } catch {
                    clearToken();
                }
            }
            setReady(true);
        })();
    }, []);

    async function refreshMe() {
        try {
            setMe(await fetchMe());
        } catch {
            // Ignore — a stale banner/permission state is harmless until the next refresh.
        }
    }

    function handleAuthenticated(nextUser: User) {
        setUser(nextUser);
        refreshMe();
    }

    function logout() {
        clearToken();
        setUser(null);
        setMe(null);
        navigate('composer');
    }

    function toggleTheme() {
        setTheme(getNextTheme);
    }

    function navigate(
        next: AppRoute,
        params: Record<string, string | undefined> = {},
    ) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            if (value) search.set(key, value);
        }
        const path = pathForRoute(next);
        const url = search.size ? `${path}?${search}` : path;
        if (`${window.location.pathname}${window.location.search}` !== url) {
            window.history.pushState({}, '', url);
        }
        setView(next);
        setLocationPathname(window.location.pathname);
        setLocationSearch(window.location.search);
    }

    function openEditRoute(id: string) {
        const url = pathForEdit(id);
        if (`${window.location.pathname}${window.location.search}` !== url) {
            window.history.pushState({}, '', url);
        }
        setView('composer');
        setLocationPathname(window.location.pathname);
        setLocationSearch(window.location.search);
    }

    function openPublishedOrDraftRoute(
        draftId: string,
        publicationId?: string,
    ) {
        openEditRoute(editIdForPublishedOrDraft(draftId, publicationId));
    }

    function renderPage() {
        if (view === 'resources') return <ResourcesPage />;
        if (view === 'scheduled') {
            return (
                <ScheduledPage
                    onOpenDraft={(draftId, publicationId) =>
                        openPublishedOrDraftRoute(draftId, publicationId)
                    }
                />
            );
        }
        if (view === 'settings') return <SettingsPage />;
        const search = new URLSearchParams(locationSearch);
        return (
            <ComposerPage
                theme={theme}
                initialEditId={editIdFromPath(locationPathname)}
                initialPublicationId={search.get('publicationId') ?? undefined}
                onOpenDraftRoute={openEditRoute}
                onNewDraftRoute={() => navigate('composer')}
            />
        );
    }

    function navItem(route: AppRoute, label: string) {
        return {
            label,
            active: view === route,
            onClick: () => navigate(route),
        };
    }

    function goToComposerRoute() {
        window.history.pushState({}, '', pathForRoute('composer'));
        setView('composer');
        setLocationPathname(window.location.pathname);
        setLocationSearch(window.location.search);
    }

    return (
        <ToastProvider>
            <MeProvider me={me}>
                {!ready ? null : inviteToken ? (
                    <InviteAcceptPage
                        token={inviteToken}
                        onAccepted={(acceptedUser) => {
                            handleAuthenticated(acceptedUser);
                            goToComposerRoute();
                        }}
                    />
                ) : verifyEmailToken ? (
                    <VerifyEmailPage
                        token={verifyEmailToken}
                        onGoToApp={goToComposerRoute}
                    />
                ) : resetPasswordToken ? (
                    <ResetPasswordPage
                        token={resetPasswordToken}
                        onReset={(resetUser) => {
                            handleAuthenticated(resetUser);
                            goToComposerRoute();
                        }}
                    />
                ) : confirmEmailChangeToken ? (
                    <ConfirmEmailChangePage
                        token={confirmEmailChangeToken}
                        onGoToApp={goToComposerRoute}
                    />
                ) : user ? (
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
                        emailVerified={me?.emailVerified}
                    >
                        {renderPage()}
                    </AppLayout>
                ) : (
                    <Auth onAuthenticated={handleAuthenticated} />
                )}
            </MeProvider>
        </ToastProvider>
    );
}
