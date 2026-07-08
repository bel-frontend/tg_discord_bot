// One-off diagnostic: dumps the real Threads DOM (contenteditable fields + clickable
// "button-ish" elements) using the already-connected browser session, so the compose
// selectors in src/platforms/threads.ts can be fixed against ground truth instead of guesses.
import { connect } from '../src/db';
import { browserSessions } from '../src/db';
import { acquireAutomationContext } from '../src/browserSessions';

await connect();

const doc = await browserSessions().findOne({ platform: 'threads', status: 'connected' });
if (!doc) {
    console.error('No connected Threads session found in the browserSessions collection.');
    process.exit(1);
}
console.log(`Using accountId: ${doc.accountId}`);

const { page, release } = await acquireAutomationContext(doc.accountId, 'threads');

async function dump(label: string) {
    console.log(`\n\n########## ${label} ##########`);
    console.log('Current URL:', page.url());

    const editableFields = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div[contenteditable="true"]')).map(
            (el) => ({
                ariaLabel: el.getAttribute('aria-label'),
                role: el.getAttribute('role'),
                testId: el.getAttribute('data-testid'),
                outerHTML: el.outerHTML.slice(0, 400),
            }),
        );
    });
    console.log('--- contenteditable fields ---');
    console.log(JSON.stringify(editableFields, null, 2));

    const buttonish = await page.evaluate(() => {
        const keywords = [
            'опубл', 'публи', 'post', 'publish', 'создат', 'новая ветк',
            'new thread', 'apublik', 'stvary', 'отмена', 'cancel',
        ];
        return Array.from(document.querySelectorAll('div[role="button"], button, a'))
            .map((el) => ({
                tag: el.tagName,
                text: (el.textContent || '').trim().slice(0, 60),
                ariaLabel: el.getAttribute('aria-label'),
                testId: el.getAttribute('data-testid'),
                ariaDisabled: el.getAttribute('aria-disabled'),
                ariaHaspopup: el.getAttribute('aria-haspopup'),
                outerHTML: el.outerHTML.slice(0, 400),
            }))
            .filter((x) => {
                const haystack = `${x.text} ${x.ariaLabel || ''}`.toLowerCase();
                return keywords.some((k) => haystack.includes(k));
            });
    });
    console.log('--- button-ish elements matching keywords ---');
    console.log(JSON.stringify(buttonish, null, 2));

    const dialogCount = await page.evaluate(
        () => document.querySelectorAll('[role="dialog"]').length,
    );
    console.log('--- [role="dialog"] count on page:', dialogCount, '---');
}

try {
    const testText = `Composer test post — please ignore, deleting shortly (${Date.now()})`;
    await page.goto(
        `https://www.threads.com/intent/post?text=${encodeURIComponent(testText)}`,
        { waitUntil: 'domcontentloaded' },
    );
    await page.waitForTimeout(2500);
    await page.screenshot({ path: '/tmp/threads-debug-intent.png' });
    console.log('Saved screenshot: /tmp/threads-debug-intent.png');

    const editorText = await page.evaluate(() =>
        document.querySelector('div[contenteditable="true"]')?.textContent,
    );
    console.log('Editor text after intent navigation:', JSON.stringify(editorText));

    // Scope strictly to the open dialog and exclude the "Post options" button
    // (also has aria-haspopup="dialog") and the Cancel button (leftmost).
    const dialogButtons = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return [];
        return Array.from(dialog.querySelectorAll('div[role="button"]')).map((el) => ({
            text: (el.textContent || '').trim().slice(0, 40),
            hasPopup: el.getAttribute('aria-haspopup'),
        }));
    });
    console.log('Dialog-scoped buttons:', JSON.stringify(dialogButtons, null, 2));

    const submitBtn = page.locator(
        '[role="dialog"] div[role="button"]:has-text("Опубликовать")',
    );
    console.log('Submit button candidates count:', await submitBtn.count());

    await submitBtn.first().click();
    console.log('Clicked submit button candidate.');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/threads-debug-after-submit.png' });
    console.log('Saved screenshot: /tmp/threads-debug-after-submit.png');
    console.log('URL after submit:', page.url());

    const postLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/post/"]')).map((a) =>
            (a as HTMLAnchorElement).href,
        ),
    );
    console.log('Post links found on page after submit:', postLinks);
} finally {
    await release();
}

process.exit(0);
