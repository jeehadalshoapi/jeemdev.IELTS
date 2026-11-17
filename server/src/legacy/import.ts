import { randomUUID } from 'node:crypto';
import { validateTest, type Issue } from '@ielts/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { tests } from '../db/schema';
import { fileUrl, type FileStore } from '../files/store';
import { createTest } from '../tests/repository';
import { convertLegacyExam, legacyFileIds, readLegacyExport, type LegacyFile } from './convert';

export interface LegacyImportResult {
  title: string;
  status: 'imported' | 'skipped' | 'invalid';
  id?: string;
  files: number;
  errors: Issue[];
  warnings: Issue[];
  notes: string[];
}

function decodeDataUrl(url: string): { data: Buffer; mimeType: string } {
  const m = url.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
  if (!m) throw new Error('not a data: URL');
  const mimeType = m[1] || 'application/octet-stream';
  const payload = m[3] ?? '';
  return { mimeType, data: m[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8') };
}

/**
 * Import tests from the old site's "Export all" file (old attempts are not imported).
 * Tests whose title already exists are skipped, so running it twice is safe.
 */
export async function importLegacyExport(db: Db, store: FileStore, data: unknown): Promise<LegacyImportResult[]> {
  const exp = readLegacyExport(data);
  const results: LegacyImportResult[] = [];

  for (const exam of exp.exams) {
    const title = exam.title?.trim() || 'Imported test';
    const [existing] = await db.select({ id: tests.id }).from(tests).where(eq(tests.title, title)).limit(1);
    if (existing) {
      results.push({ title, status: 'skipped', id: existing.id, files: 0, errors: [], warnings: [], notes: ['a test with this title is already in the database'] });
      continue;
    }

    // give every file in the export its new id first, so the converted test can point at /files/<id>
    const planned = new Map<string, { id: string; file: LegacyFile }>();
    for (const legacyId of legacyFileIds(exam)) {
      const file = exp.files[legacyId];
      if (file && !planned.has(legacyId)) planned.set(legacyId, { id: randomUUID(), file });
    }
    const { doc, notes } = convertLegacyExam(exam, legacyId => {
      const p = planned.get(legacyId);
      return p ? fileUrl(p.id) : undefined;
    });

    const check = validateTest(doc);
    if (!check.ok) {
      results.push({ title, status: 'invalid', files: 0, errors: check.errors, warnings: check.warnings, notes });
      continue;
    }

    const testId = randomUUID();
    const { warnings } = await createTest(db, doc, { source: 'manual', id: testId });
    let saved = 0;
    for (const { id, file } of planned.values()) {
      try {
        const { data: bytes, mimeType } = decodeDataUrl(file.data);
        const type = file.type || mimeType;
        await store.save({ id, data: bytes, originalName: file.name, mimeType: type, kind: type.startsWith('audio/') ? 'audio' : 'image', testId });
        saved++;
      } catch (e) {
        notes.push(`file "${file.name}" could not be saved: ${(e as Error).message}`);
      }
    }
    results.push({ title, status: 'imported', id: testId, files: saved, errors: [], warnings, notes });
  }
  return results;
}
