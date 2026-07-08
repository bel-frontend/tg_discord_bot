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
// Browser-session platforms drive a real logged-in browser instead of an official API —
// fail fast at boot if the encryption key they persist login sessions with is missing.
assertBrowserSessionCryptoConfigured();
register(new XPlatform());
register(new ThreadsPlatform());

// 3. Scheduled publication worker
startScheduler();

// 4. Browser session idle/timeout sweep (closes stale live-view and automation contexts)
startBrowserSessionSweep();

// 5. HTTP API + editor frontend
startServer();

console.log('Composer ready.');
