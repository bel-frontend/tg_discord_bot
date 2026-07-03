export type AppTheme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'theme';

export function readInitialTheme(): AppTheme {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light'
        ? 'light'
        : 'dark';
}

export function persistTheme(theme: AppTheme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function toggleTheme(theme: AppTheme): AppTheme {
    return theme === 'dark' ? 'light' : 'dark';
}
