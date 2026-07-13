interface SessionCookie {
    name: string;
    value: string;
    domain?: string;
}

export function hasMatchingSessionCookie(
    cookies: SessionCookie[],
    names: string[],
    domains: string[],
): boolean {
    return cookies.some(
        (cookie) =>
            names.includes(cookie.name) &&
            Boolean(cookie.value) &&
            domains.some((domain) =>
                (cookie.domain ?? '').replace(/^\./, '').endsWith(domain),
            ),
    );
}

export function isConnectedPageUrl(
    currentUrl: string,
    homeUrl: string,
    loginUrl: string,
): boolean {
    try {
        const current = new URL(currentUrl);
        const home = new URL(homeUrl);
        const login = new URL(loginUrl);
        return (
            current.origin === home.origin &&
            !current.pathname.startsWith(login.pathname)
        );
    } catch {
        return false;
    }
}
