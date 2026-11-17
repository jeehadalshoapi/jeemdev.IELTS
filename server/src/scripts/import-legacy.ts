// npm run db:import-legacy -- <path to the old site's "Export all" .json file>
import { readFile } from 'node:fs/promises';
import { formatIssues } from '@ielts/shared';
import { openDatabase } from '../db/client';
import { env } from '../env';
import { FileStore } from '../files/store';
import { importLegacyExport } from '../legacy/import';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run db:import-legacy -- <export.json>');
  process.exit(1);
}

const database = await openDatabase();
await database.migrate();
const results = await importLegacyExport(database.db, new FileStore(database.db, env.uploadDir), JSON.parse(await readFile(file, 'utf8')));

for (const r of results) {
  const icon = r.status === 'imported' ? '✓' : r.status === 'skipped' ? '–' : '✗';
  console.log(`\n${icon} ${r.title} — ${r.status}${r.id ? ` (id ${r.id})` : ''}${r.files ? `, ${r.files} file(s)` : ''}`);
  if (r.errors.length) console.log(formatIssues(r.errors));
  if (r.warnings.length) console.log('warnings:\n' + formatIssues(r.warnings));
  for (const n of r.notes) console.log(`  note: ${n}`);
}
const imported = results.filter(r => r.status === 'imported').length;
console.log(`\n${imported} imported, ${results.filter(r => r.status === 'skipped').length} skipped, ${results.filter(r => r.status === 'invalid').length} invalid.`);
await database.close();
