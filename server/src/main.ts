// The web server: website + REST API (and, from Phase 5, the MCP endpoint).
import { count } from 'drizzle-orm';
import { purgeExpiredSessions } from './auth/sessions';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { tests } from './db/schema';
import { FileStore } from './files/store';
import { createApp } from './http/app';
import { seedSample } from './seed';

const config = await loadConfig();
const database = await openDatabase();
await database.migrate();

// first start on an empty database: add the sample reading test so the dashboard is not empty
const [{ n } = { n: 0 }] = await database.db.select({ n: count() }).from(tests);
if (Number(n) === 0) {
  await seedSample(database.db);
  console.log('Empty database: added the sample reading test.');
}

const app = createApp({ database, config, fileStore: new FileStore(database.db, config.uploadDir) });
const server = app.listen(config.port, () => {
  console.log(`IELTS platform listening on :${config.port} (${config.isProd ? 'production' : 'development'}, database: ${database.kind})`);
});

const purge = setInterval(() => { purgeExpiredSessions(database.db).catch(e => console.error('[sessions] purge failed', e)); }, 3600_000);
purge.unref();

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down`);
    server.close(() => { database.close().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
