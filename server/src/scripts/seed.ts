// npm run db:seed — apply migrations, then add the sample reading test (safe to run again)
import { openDatabase } from '../db/client';
import { seedSample } from '../seed';

const database = await openDatabase();
await database.migrate();
const r = await seedSample(database.db);
console.log(r.created ? `Seeded the sample reading test (id ${r.id}).` : `Sample reading test already present (id ${r.id}).`);
await database.close();
