import { connect } from './src/db';
import { register } from './src/platforms/registry';
import { TelegramPlatform } from './src/platforms/telegram';
import { DiscordPlatform } from './src/platforms/discord';
import { ThreadsPlatform } from './src/platforms/threads';
import { XPlatform } from './src/platforms/x';
import { startScheduler } from './src/scheduler';
import { startServer } from './src/server';
import {
    assertBrowserSessionCryptoConfigured,
    startBrowserSessionSweep,
} from './src/browserSessions';

console.log('Starting Composer…');

// 1. Persistence
await connect();

// 2. Register publishing platforms. Add a new social network by implementing the
//    Platform interface (src/platforms/types.ts) and registering it here.
register(new TelegramPlatform());
register(new DiscordPlatform());
register(new ThreadsPlatform());
// Browser-session platforms drive a real logged-in browser instead of an official API.
// If their encryption key is missing on a deployment, keep the rest of the app online
// and make the disabled feature obvious in logs instead of taking down the server.
let browserSessionPlatformsEnabled = false;
try {
    assertBrowserSessionCryptoConfigured();
    register(new XPlatform());
    browserSessionPlatformsEnabled = true;
} catch (error: any) {
    console.warn(
        `Browser-session platforms disabled: ${
            error?.message || 'invalid browser session configuration'
        }`,
    );
}

// 3. Scheduled publication worker
startScheduler();

// 4. Browser session idle/timeout sweep (closes stale live-view and automation contexts)
if (browserSessionPlatformsEnabled) {
    startBrowserSessionSweep();
}

// 5. HTTP API + editor frontend
startServer();

console.log('Composer ready.');
