import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totalMarks } from '@ielts/shared';
import { openDatabase, type Database } from '../src/db/client';
import { files } from '../src/db/schema';
import { FileStore } from '../src/files/store';
import { inferWordLimit } from '../src/legacy/convert';
import { importLegacyExport } from '../src/legacy/import';
import { getTest } from '../src/tests/repository';

// a real "Export all" file produced by the old browser-only site (baseline commit)
const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'legacy-export.json');

let database: Database;
let uploadDir: string;
let store: FileStore;

beforeAll(async () => {
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate();
  uploadDir = await mkdtemp(path.join(os.tmpdir(), 'ielts-uploads-'));
  store = new FileStore(database.db, uploadDir);
});
afterAll(async () => {
  await database.close();
  await rm(uploadDir, { recursive: true, force: true });
});

describe('legacy import (old site → database)', () => {
  it('converts and imports every test in the export, with its audio', async () => {
    const data = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const results = await importLegacyExport(database.db, store, data);
    const summary = results.map(r => `${r.status}: ${r.title} ${r.errors.map(e => `${e.path} ${e.message}`).join('; ')}`);
    expect(results.every(r => r.status === 'imported'), summary.join('\n')).toBe(true);
    expect(results).toHaveLength(5);

    const byTitle = Object.fromEntries(results.map(r => [r.title, r]));

    // reading sample: same 17 marks and question types as before
    const reading = await getTest(database.db, byTitle['Sample Reading — Urban Beekeeping']!.id!);
    expect(reading && totalMarks(reading.document.parts)).toBe(17);
    expect(reading?.document.parts[0]?.questionGroups.map(g => g.type)).toEqual(['matching_headings', 'tfng', 'mcq_single', 'summary_completion', 'mcq_multi', 'short_answer']);
    expect(reading?.document.parts[0]?.passage?.paragraphs[0]?.label).toBe('A');
    expect(reading?.document.answerKey.q15).toEqual({ accept: ['A', 'C'] });
    expect(reading?.document.answerKey.q17).toEqual({ accept: ['(the) colony collapse disorder'] });

    // listening template: audio files saved and linked
    const listening = byTitle['Cambridge 18 — Test 1 Listening']!;
    expect(listening.files).toBe(4);
    const l = await getTest(database.db, listening.id!);
    const audioUrl = l?.document.parts[0]?.audioUrl;
    expect(audioUrl).toMatch(/^\/files\/[0-9a-f-]{36}$/);
    const fileRows = await database.db.select().from(files);
    const row = fileRows.find(f => `/files/${f.id}` === audioUrl);
    expect(row).toMatchObject({ kind: 'audio', originalName: 'part1.mp3', testId: listening.id });
    const onDisk = await readFile(store.absolutePath(row!.storagePath));
    expect(onDisk.byteLength).toBe(row!.sizeBytes);
    expect(l?.document.parts[0]?.questionGroups.map(g => g.type)).toEqual(['form_completion', 'table_completion']);

    // writing: tasks become writing_task1 / writing_task2
    const w = await getTest(database.db, byTitle['Cambridge 18 — Test 1 Writing']!.id!);
    expect(w?.document.parts.map(p => p.questionGroups[0]?.type)).toEqual(['writing_task1', 'writing_task2']);
    const gt = await getTest(database.db, byTitle['Sample Writing — General Training']!.id!);
    expect(gt?.document.variant).toBe('general_training');
  });

  it('notes a file that the test refers to but the export does not contain', async () => {
    const data = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const exam = data.exams.find((e: { module: string }) => e.module === 'writing');
    exam.title = 'Writing with lost chart';
    exam.parts[0].imageId = 'file_not_in_export';
    const [r] = await importLegacyExport(database.db, store, { exams: [exam], files: data.files });
    expect(r?.status).toBe('imported');
    expect(r?.notes.join(' ')).toContain('Task 1 picture: the file was not in the export');
  });

  it('skips tests that were already imported', async () => {
    const data = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const again = await importLegacyExport(database.db, store, data);
    expect(again.every(r => r.status === 'skipped')).toBe(true);
  });

  it('reports a test that cannot be converted instead of saving it', async () => {
    const data = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const exam = data.exams.find((e: { module: string }) => e.module === 'listening');
    exam.title = 'Broken listening';
    // no recording and no transcript anywhere (a later part may rely on an earlier part's recording, so clear them all)
    for (const p of exam.parts) { p.audioId = null; p.transcript = ''; }
    const [r] = await importLegacyExport(database.db, store, { exams: [exam], files: data.files });
    expect(r?.status).toBe('invalid');
    expect(r?.errors).toContainEqual({ path: 'parts[0].transcript', message: expect.stringContaining('is required for a listening part') });
  });

  it('infers word limits from instructions', () => {
    expect(inferWordLimit('Choose **NO MORE THAN TWO WORDS AND/OR A NUMBER** from the passage')).toEqual({ maxWords: 2, allowNumber: true });
    expect(inferWordLimit('Write ONE WORD ONLY for each answer.')).toEqual({ maxWords: 1, allowNumber: false });
    expect(inferWordLimit('Complete the notes.')).toBeUndefined();
  });
});
