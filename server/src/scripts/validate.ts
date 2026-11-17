// npm run validate -- <test.json> — check a test JSON file (e.g. one Claude wrote) without saving it
import { readFile } from 'node:fs/promises';
import { formatIssues, totalMarks, validateTest } from '@ielts/shared';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run validate -- <test.json>');
  process.exit(1);
}

let input: unknown;
try {
  input = JSON.parse(await readFile(file, 'utf8'));
} catch (e) {
  console.error(`Not valid JSON: ${(e as Error).message}`);
  process.exit(1);
}

const r = validateTest(input);
if (r.ok) {
  console.log(`✓ Valid: "${r.test.title}" — ${r.test.skill}, ${r.test.parts.length} part(s), ${totalMarks(r.test.parts)} auto-scored mark(s).`);
} else {
  console.log(`✗ ${r.errors.length} problem(s):\n${formatIssues(r.errors)}`);
}
if (r.warnings.length) console.log(`\nWarnings:\n${formatIssues(r.warnings)}`);
process.exit(r.ok ? 0 : 1);
