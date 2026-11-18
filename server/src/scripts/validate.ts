// npm run validate -- <test.json | test.txt> — check a test (JSON as Claude writes it, or the text format) without saving it.
// Audio and picture file names are not checked here; the import page asks for the files.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImportIssue } from '@ielts/shared';
import { prepareImport } from '../import/service';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run validate -- <test.json | test.txt>');
  process.exit(1);
}

const list = (issues: ImportIssue[]) => issues.map(i => `- ${i.where ? `[${i.where}] ` : ''}${i.path}: ${i.message}`).join('\n');
const r = prepareImport(await readFile(path.resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8'), {}, { assumeFiles: true });
if (r.ok && r.summary) {
  const s = r.summary;
  console.log(`✓ Valid (${r.format}): "${s.title}" — ${s.skill}, ${s.parts.length} part(s), ${s.marks} auto-scored mark(s).`);
} else {
  console.log(`✗ ${r.errors.length} problem(s) (${r.format}):\n${list(r.errors)}`);
}
if (r.warnings.length) console.log(`\nWarnings:\n${list(r.warnings)}`);
process.exit(r.ok ? 0 : 1);
