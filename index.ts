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

// 4. Optional legacy inbound bridge (send a message to the Telegram bot -> forward).
//    Off by default: it opens its own Telegram poller / Discord gateway using the same
//    tokens as the editor's publishers, so only enable it if you understand that trade-off.
if (process.env.ENABLE_INBOUND_BOTS === 'true') {
    console.log('Enabling legacy inbound bot bridge…');
    await import('./inbound');
}

console.log('Composer ready.');
