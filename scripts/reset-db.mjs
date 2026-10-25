import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataDir = resolve(process.cwd(), process.env.DATA_DIR || './data');

for (const file of ['royal-palace.db', 'royal-palace.db-wal', 'royal-palace.db-shm']) {
  rmSync(join(dataDir, file), { force: true });
}

console.log(`Database reset. ${dataDir} will be reseeded on the next request.`);
