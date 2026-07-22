export function buildClickThreadsPostActionScript(
    targetLink: string,
    actionLabels: string[],
): string {
    return `(() => {
        const actionLabels = ${JSON.stringify(actionLabels)};
        const labelOf = (candidate) =>
            (candidate.getAttribute('aria-label') ||
                candidate.querySelector('[aria-label]')
                    ?.getAttribute('aria-label') ||
                candidate.textContent || '')
                .trim()
                .toLowerCase();
        const isAction = (candidate) => {
            const label = labelOf(candidate);
            return actionLabels.some((expected) =>
                label === expected ||
                label.startsWith(expected + ' ') ||
                label.startsWith(expected + '(')
            );
        };
        const visible = (candidate) => candidate.getClientRects().length > 0;
        const editor = Array.from(document.querySelectorAll(
            '[role="dialog"] [contenteditable="true"], ' +
            '[contenteditable="true"][role="textbox"], ' +
            '[contenteditable="true"][data-lexical-editor="true"], ' +
            'textarea'
        )).find(visible);
        if (editor) {
            editor.focus();
            return true;
        }

        const promptPrefixes = [
            'reply to', 'odpowiedz użytkownikowi',
            'адкажыце', 'ответьте'
        ];
        const prompt = Array.from(document.querySelectorAll(
            '[placeholder], [aria-label], [role="button"]'
        )).find((candidate) => {
            if (!visible(candidate)) return false;
            const value = (
                candidate.getAttribute('placeholder') ||
                candidate.getAttribute('aria-label') ||
                candidate.textContent || ''
            ).trim().toLowerCase();
            return promptPrefixes.some((prefix) => value.startsWith(prefix));
        });
        if (prompt) {
            (prompt.closest('[role="button"], button') || prompt).click();
            return true;
        }

        const trimTrailingSlash = (value) =>
            value.endsWith('/') ? value.slice(0, -1) : value;
        const targetPath = trimTrailingSlash(
            new URL(${JSON.stringify(targetLink)}).pathname
        );
        const permalink = Array.from(document.querySelectorAll(
            'a[href*="/post/"]'
        )).find((link) => {
            try {
                return trimTrailingSlash(new URL(link.href).pathname) ===
                    targetPath;
            } catch {
                return false;
            }
        });
        let container = permalink;
        let button;
        for (let depth = 0; container && depth < 12; depth += 1) {
            button = Array.from(container.querySelectorAll(
                '[role="button"], button'
            )).find((candidate) => visible(candidate) && isAction(candidate));
            if (button) break;
            container = container.parentElement;
        }
        if (!button) return false;
        button.click();
        return true;
    })()`;
}

export function buildClickThreadsReplyScript(targetLink: string): string {
    return buildClickThreadsPostActionScript(targetLink, [
        'reply',
        'odpowiedz',
        'адказаць',
        'ответить',
    ]);
}
