// Finds and clicks whichever visible button under targetLink's post matches
// actionLabels, by walking up from that post's permalink through its
// ancestors. Used for action icons that always require locating the
// specific post's own control (e.g. its "More" menu) — as opposed to
// composer-opening actions, which also accept an already-open editor or a
// localized "reply to" prompt (see buildClickThreadsPostActionScript below).
export function buildClickThreadsActionButtonScript(
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
            return actionLabels.some((expected) => label.startsWith(expected));
        };
        const visible = (candidate) => candidate.getClientRects().length > 0;
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

// Opens the reply composer for targetLink's post: reuses an already-open
// editor or a localized "reply to" prompt if either is already visible
// (Threads sometimes renders these without requiring a click first), and
// otherwise falls back to clicking the post's own reply action button.
export function buildClickThreadsPostActionScript(
    targetLink: string,
    actionLabels: string[],
): string {
    return `(() => {
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

        return ${buildClickThreadsActionButtonScript(targetLink, actionLabels)};
    })()`;
}

export function buildClickThreadsReplyScript(targetLink: string): string {
    return buildClickThreadsPostActionScript(targetLink, [
        'reply',
        'odpowied',
        'адказ',
        'ответ',
    ]);
}
