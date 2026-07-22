// Captures which nearby buttons are disabled before the reply text is typed,
// so buildClickThreadsSubmitScript can later find whichever one became
// enabled purely from that state change — a fallback that works even if the
// submit button carries no recognizable label at all (unlabeled icon, or
// copy in a language/wording the `labels` list below doesn't anticipate).
export function buildSnapshotThreadsComposerButtonsScript(): string {
    return `(() => {
        const isDisabled = (candidate) =>
            candidate.getAttribute('aria-disabled') === 'true' ||
            !!candidate.disabled;
        let container = document.activeElement;
        const seen = new Set();
        const snapshot = [];
        for (let depth = 0; container && depth < 12; depth += 1) {
            for (const candidate of container.querySelectorAll(
                '[role="button"], button'
            )) {
                if (seen.has(candidate)) continue;
                seen.add(candidate);
                snapshot.push({
                    el: candidate,
                    wasDisabled: isDisabled(candidate),
                });
            }
            container = container.parentElement;
        }
        window.__threadsComposerButtons = snapshot;
        return true;
    })()`;
}

export function buildClickThreadsSubmitScript(): string {
    return `(() => {
        const labels = [
            'post', 'publish', 'opublikuj',
            'апублікав', 'опубликова',
            'reply', 'odpowied', 'адказ', 'ответ'
        ];
        const labelOf = (candidate) =>
            (candidate.getAttribute('aria-label') ||
                candidate.querySelector('[aria-label]')
                    ?.getAttribute('aria-label') ||
                candidate.textContent || '')
                .trim()
                .toLowerCase();
        const isSubmit = (candidate) => {
            const label = labelOf(candidate);
            return labels.some((expected) => label.startsWith(expected));
        };
        const visible = (candidate) =>
            candidate.getClientRects().length > 0 &&
            candidate.getAttribute('aria-disabled') !== 'true' &&
            !candidate.disabled;
        let container = document.activeElement;
        let button;
        for (let depth = 0; container && depth < 12; depth += 1) {
            button = Array.from(container.querySelectorAll(
                '[role="button"], button'
            )).find((candidate) => visible(candidate) && isSubmit(candidate));
            if (button) break;
            container = container.parentElement;
        }
        button ||= Array.from(document.querySelectorAll(
            '[role="dialog"] [role="button"], [role="dialog"] button'
        )).find((candidate) => visible(candidate) && isSubmit(candidate));
        if (!button) {
            const snapshot = window.__threadsComposerButtons || [];
            button = snapshot.find(({ el, wasDisabled }) =>
                wasDisabled && visible(el)
            )?.el;
        }
        if (!button) return false;
        button.click();
        return true;
    })()`;
}
