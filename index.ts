import { connect } from './src/db';
import { register } from './src/platforms/registry';
import { TelegramPlatform } from './src/platforms/telegram';
import { DiscordPlatform } from './src/platforms/discord';
import { startServer } from './src/server';

console.log('Starting Composer…');

// 1. Persistence
await connect();

// 2. Register publishing platforms. Add a new social network by implementing the
//    Platform interface (src/platforms/types.ts) and registering it here.
register(new TelegramPlatform());
register(new DiscordPlatform());

// 3. HTTP API + editor frontend
startServer();

console.log('Composer ready.');
