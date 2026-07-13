import { connect } from './src/db';
import { register } from './src/platforms/registry';
import { TelegramPlatform } from './src/platforms/telegram';
import { DiscordPlatform } from './src/platforms/discord';
import { ThreadsPlatform } from './src/platforms/threads';
import { XPlatform } from './src/platforms/x';
import { startScheduler } from './src/scheduler';
import { startServer } from './src/server';

console.log('Starting Composer…');

// 1. Persistence
await connect();

// 2. Register publishing platforms. Add a new social network by implementing the
//    Platform interface (src/platforms/types.ts) and registering it here.
register(new TelegramPlatform());
register(new DiscordPlatform());
register(new ThreadsPlatform());
register(new XPlatform());

// 3. Scheduled publication worker
startScheduler();

// 4. HTTP API + editor frontend
startServer();

console.log('Composer ready.');
