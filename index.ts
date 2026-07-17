import { connect } from './src/db';
import { loadPlatforms } from './src/platforms/loader';
import { startScheduler } from './src/scheduler';
import { startServer } from './src/server';

console.log('Starting Composer…');

// 1. Persistence
await connect();

// 2. Load publishing platforms. Add a new social network by dropping a folder
//    into src/platforms/ that exports createPlatform() — see docs/platform-plugins.md.
const { loaded } = await loadPlatforms();
console.log(`Platforms loaded: ${loaded.join(', ')}`);

// 3. Scheduled publication worker
startScheduler();

// 4. HTTP API + editor frontend
startServer();

console.log('Composer ready.');
