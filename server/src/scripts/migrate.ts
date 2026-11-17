// npm run db:migrate — apply all SQL migrations in server/drizzle
import { openDatabase } from '../db/client';
import { env } from '../env';

const database = await openDatabase();
console.log(`Database: ${database.kind === 'postgres' ? 'PostgreSQL (DATABASE_URL)' : `PGlite at ${env.pgliteDir}`}`);
await database.migrate();
console.log('Migrations applied.');
await database.close();
