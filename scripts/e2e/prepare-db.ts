// Fresh database for browser checks: the sample reading test + a listening drill (with transcript) + a writing task.
//   npx tsx scripts/e2e/prepare-db.ts        (writes .data/e2e/ids.json)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { exampleTestForType } from '../../shared/src';
import { openDatabase } from '../../server/src/db/client';
import { seedSample } from '../../server/src/seed';
import { createTest } from '../../server/src/tests/repository';

rmSync('.data/e2e', { recursive: true, force: true });
mkdirSync('.data/e2e', { recursive: true });
const d = await openDatabase({ pgliteDir: '.data/e2e/pglite' });
await d.migrate();
await seedSample(d.db);
const listening = await createTest(d.db, { ...exampleTestForType('form_completion'), title: 'Listening drill — Hotel booking', timeLimitMin: 10 }, { source: 'claude' });
const writing = await createTest(d.db, { ...exampleTestForType('writing_task1'), title: 'Writing Task 1 — City temperatures', kind: 'homework', dueDate: '2026-12-31' }, { source: 'claude' });
writeFileSync('.data/e2e/ids.json', JSON.stringify({ sample: '5a3f6c1e-0000-4000-8000-000000000001', listening: listening.id, writing: writing.id }));
await d.close();
console.log('Ready. Start the server with:  PGLITE_DIR=.data/e2e/pglite UPLOAD_DIR=.data/e2e/uploads node server/dist/main.js');
