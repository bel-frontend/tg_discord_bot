import { connect } from '../src/db';
import { browserSessions } from '../src/db';
import { acquireAutomationContext } from '../src/browserSessions';

const POST_ID = process.argv[2];
if (!POST_ID) {
    console.error('Usage: bun run scripts/debug-threads-delete.ts <postId>');
    process.exit(1);
}

await connect();
const doc = await browserSessions().findOne({ platform: 'threads', status: 'connected' });
if (!doc) {
    console.error('No connected Threads session found.');
    process.exit(1);
}

const { page, release } = await acquireAutomationContext(doc.accountId, 'threads');
try {
    const url = `https://www.threads.com/@piotrazsko/post/${POST_ID}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const text = await page.evaluate(() => document.body.innerText.slice(0, 300));
    console.log('Page text preview:', text);

    // Dump all buttons near the top of the post (likely includes the "..." more-options trigger).
    const buttons = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('div[role="button"]'))
            .slice(0, 40)
            .map((el) => ({
                text: (el.textContent || '').trim().slice(0, 30),
                ariaLabel: el.getAttribute('aria-label'),
                hasPopup: el.getAttribute('aria-haspopup'),
            }))
            .filter((x) => x.ariaLabel || x.hasPopup || x.text);
    });
    console.log('Buttons found:', JSON.stringify(buttons, null, 2));

    // There are multiple aria-haspopup="menu" triggers on the page (e.g. the sidebar's
    // own "Ещё" nav item) — the post's own three-dot menu is near the top of the main
    // column, so rank candidates by vertical position instead of just taking the first.
    const candidates = await page.evaluate(() => {
        return Array.from(
            document.querySelectorAll('div[role="button"][aria-haspopup="menu"]'),
        )
            .map((el, index) => {
                const rect = el.getBoundingClientRect();
                return {
                    index,
                    text: (el.textContent || '').trim().slice(0, 20),
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    visible: rect.width > 0 && rect.height > 0,
                };
            })
            .filter((c) => c.visible);
    });
    console.log('aria-haspopup=menu candidates with position:', JSON.stringify(candidates, null, 2));

    // y=18 turned out to be a generic app-level "..." menu (Add as column), not the
    // post's own menu — try the next-closest-to-top candidate instead.
    const sorted = [...candidates].sort((a, b) => a.y - b.y);
    const targetIndex = sorted[1]?.index ?? sorted[0]?.index;
    console.log('Clicking candidate index:', targetIndex, sorted[0]);
    if (targetIndex === undefined) throw new Error('No candidates found');

    await page
        .locator('div[role="button"][aria-haspopup="menu"]')
        .nth(targetIndex)
        .click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/threads-debug-more-menu.png' });

    const menuItems = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('[role="menuitem"]')).map((el) =>
            (el.textContent || '').trim(),
        );
    });
    console.log('Menu items visible (role=menuitem only):', JSON.stringify(menuItems, null, 2));

    await page.locator('[role="menuitem"]:has-text("Удалить")').first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/threads-debug-delete-confirm.png' });

    const confirmCandidates = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
        if (!dialog) return { found: false, buttons: [] };
        return {
            found: true,
            buttons: Array.from(dialog.querySelectorAll('div[role="button"]')).map(
                (el) => (el.textContent || '').trim(),
            ),
        };
    });
    console.log('Delete confirmation dialog:', JSON.stringify(confirmCandidates, null, 2));

    await page
        .locator('[role="dialog"] div[role="button"]:has-text("Удалить")')
        .first()
        .click();
    await page.waitForTimeout(2000);
    console.log('Confirmed deletion. Current URL:', page.url());
    await page.screenshot({ path: '/tmp/threads-debug-after-delete.png' });
} finally {
    await release();
}
process.exit(0);
