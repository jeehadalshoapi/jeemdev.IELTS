// npm run db:tests — print the tests stored in the database
import { openDatabase } from '../db/client';
import { listTests } from '../tests/repository';

const database = await openDatabase();
await database.migrate();
const rows = await listTests(database.db, { limit: 200 });
if (!rows.length) console.log('No tests yet. Run: npm run db:seed');
else console.table(rows.map(r => ({
  id: r.id.slice(0, 8) + '…', title: r.title.length > 42 ? r.title.slice(0, 41) + '…' : r.title,
  skill: r.skill, kind: r.kind, status: r.status, marks: r.marks, attempts: r.attemptCount, source: r.source
})));
await database.close();
