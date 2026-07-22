export function buildClickThreadsSubmitScript(): string {
    return `(() => {
        const labels = [
            'post', 'publish', 'opublikuj',
            'апублікаваць', 'опубликовать',
            'reply', 'odpowiedz', 'адказаць', 'ответить'
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
            return labels.some((expected) =>
                label === expected || label.startsWith(expected + ' ')
            );
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
        if (!button) return false;
        button.click();
        return true;
    })()`;
}
