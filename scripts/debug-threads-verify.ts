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
    await page.goto('https://www.threads.com/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // Find the "Профиль" nav link's href to get our own username, then visit it.
    const profileHref = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const profile = links.find((a) => (a.textContent || '').includes('Профиль'));
        return profile?.getAttribute('href') || null;
    });
    console.log('Profile href:', profileHref);
    if (!profileHref) throw new Error('Could not find profile link');

    await page.goto(`https://www.threads.com${profileHref}`, {
        waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/threads-debug-profile.png' });

    const latestPosts = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/post/"]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((href) => !href.includes('/media')),
    );
    console.log('Latest post links on profile:', JSON.stringify(latestPosts.slice(0, 5), null, 2));
} finally {
    await release();
}
process.exit(0);
