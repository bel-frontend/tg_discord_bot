import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const desktop = join(root, 'desktop');
const serverUrl = process.env.COMPOSER_DESKTOP_DEV_URL || 'http://localhost:3000';

const server = Bun.spawn(['bun', 'run', 'dev'], {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
});

let desktopProcess: ReturnType<typeof Bun.spawn> | null = null;
let stopping = false;

function stop(): void {
    if (stopping) return;
    stopping = true;
    desktopProcess?.kill();
    server.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', stop);

async function waitForServer(): Promise<void> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        if (server.exitCode !== null) {
            throw new Error('Composer dev server exited before it became ready');
        }
        try {
            const response = await fetch(serverUrl, {
                signal: AbortSignal.timeout(1_500),
            });
            if (response.ok) return;
        } catch {
            // MongoDB and Next.js can take a little while to become ready.
        }
        await Bun.sleep(500);
    }
    throw new Error(
        `Composer did not become available at ${serverUrl}. Check MongoDB/VPN and the server output above.`,
    );
}

try {
    console.log(`Waiting for Composer at ${serverUrl}…`);
    await waitForServer();
    console.log('Composer is ready; starting Electron…');
    desktopProcess = Bun.spawn(['bun', 'run', 'dev'], {
        cwd: desktop,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
            ...process.env,
            COMPOSER_DESKTOP_DEV_URL: serverUrl,
        },
    });
    await desktopProcess.exited;
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    stop();
}
