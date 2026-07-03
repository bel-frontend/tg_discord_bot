import { cp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const frontendDir = join(import.meta.dir, '..');
const exportDir = join(frontendDir, 'out');
const publicDir = join(frontendDir, '..', 'public');

await rm(publicDir, { recursive: true, force: true });
await cp(exportDir, publicDir, { recursive: true });
