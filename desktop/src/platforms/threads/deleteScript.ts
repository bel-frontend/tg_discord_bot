import { buildClickThreadsPostActionScript } from './replyScript';

const DELETE_LABELS = ['delete', 'usuń', 'выдаліць', 'удалить'];

function clickLabeledControlScript(selector: string): string {
    return `(() => {
        const labels = ${JSON.stringify(DELETE_LABELS)};
        const labelOf = (candidate) =>
            (candidate.getAttribute('aria-label') ||
                candidate.querySelector('[aria-label]')
                    ?.getAttribute('aria-label') ||
                candidate.textContent || '')
                .trim()
                .toLowerCase();
        const matches = (candidate) => {
            const label = labelOf(candidate);
            return labels.some((expected) =>
                label === expected || label.startsWith(expected + ' ')
            );
        };
        const button = Array.from(document.querySelectorAll(
            ${JSON.stringify(selector)}
        )).find((candidate) =>
            candidate.getClientRects().length > 0 && matches(candidate)
        );
        if (!button) return false;
        button.click();
        return true;
    })()`;
}

export function buildClickThreadsMoreScript(targetLink: string): string {
    return buildClickThreadsPostActionScript(targetLink, [
        'more',
        'więcej',
        'яшчэ',
        'ещё',
    ]);
}

export function buildClickThreadsDeleteMenuItemScript(): string {
    return clickLabeledControlScript(
        '[role="menuitem"], [role="menu"] [role="button"], ' +
            '[role="menu"] button, [role="button"], button',
    );
}

export function buildConfirmThreadsDeleteScript(): string {
    return clickLabeledControlScript(
        '[role="dialog"] [role="button"], [role="dialog"] button',
    );
}
