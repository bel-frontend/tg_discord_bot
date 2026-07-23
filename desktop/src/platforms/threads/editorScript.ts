// Threads renders the reply/compose editor two different ways depending on
// context: an inline textbox directly on the permalink page, or a
// `[role="dialog"]` sheet layered on top of the page (the page's own,
// now-obscured inline editor can still be present underneath and still
// match the plain, unscoped selectors). This is polled repeatedly (roughly
// every 300ms) until it returns true, so once a dialog exists we must keep
// waiting for THAT dialog's own editor rather than falling back to the
// background one just because the dialog hasn't finished rendering its
// editor on an early poll — a fallback there would grab the wrong element
// and report success prematurely, before the dialog's editor ever appears.
export function buildFindThreadsEditorScript(): string {
    return `(() => {
        const visible = (candidate) =>
            candidate.getClientRects().length > 0 &&
            candidate.getAttribute('aria-hidden') !== 'true';
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
            const editor = Array.from(dialog.querySelectorAll(
                '[contenteditable="true"], textarea'
            )).find(visible);
            if (!editor) return false;
            editor.focus();
            return true;
        }
        const editor = Array.from(document.querySelectorAll(
            '[contenteditable="true"][role="textbox"], ' +
            '[contenteditable="true"][data-lexical-editor="true"], ' +
            'textarea'
        )).find(visible);
        if (!editor) return false;
        editor.focus();
        return true;
    })()`;
}
