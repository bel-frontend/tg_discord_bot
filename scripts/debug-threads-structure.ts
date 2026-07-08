import { connect } from '../src/db';
import { browserSessions } from '../src/db';
import { acquireAutomationContext } from '../src/browserSessions';

await connect();
const doc = await browserSessions().findOne({ platform: 'threads', status: 'connected' });
if (!doc) {
    console.error('No connected Threads session found.');
    process.exit(1);
}

const { page, release } = await acquireAutomationContext(doc.accountId, 'threads');
try {
    await page.goto('https://www.threads.com/@piotrazsko/post/DW1PXNwl4qk', {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2000);

    const info = await page.evaluate(() => {
        const mains = document.querySelectorAll('main');
        const menuButtonsGlobal = document.querySelectorAll(
            'div[role="button"][aria-haspopup="menu"]',
        );
        const menuButtonsInMain = mains.length
            ? mains[0].querySelectorAll('div[role="button"][aria-haspopup="menu"]')
            : [];
        return {
            mainCount: mains.length,
            globalMenuButtonCount: menuButtonsGlobal.length,
            menuButtonsInMainCount: menuButtonsInMain.length,
        };
    });
    console.log('Structure info:', JSON.stringify(info, null, 2));
} finally {
    await release();
}
process.exit(0);
