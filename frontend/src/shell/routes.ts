export type AppRoute = 'composer' | 'resources' | 'scheduled' | 'settings';

export const APP_ROUTES: Record<AppRoute, string> = {
    composer: '/',
    resources: '/resources',
    scheduled: '/scheduled',
    settings: '/settings',
};

export function routeFromPath(pathname: string): AppRoute {
    const entry = Object.entries(APP_ROUTES).find(
        ([, path]) => path !== '/' && path === pathname,
    );
    return entry ? (entry[0] as AppRoute) : 'composer';
}

export function draftIdFromPath(pathname: string): string | undefined {
    const match = pathname.match(/^\/edit\/([^/?#]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : undefined;
}

export function pathForRoute(route: AppRoute): string {
    return APP_ROUTES[route];
}

export function pathForDraft(draftId: string): string {
    return `/edit/${encodeURIComponent(draftId)}`;
}
