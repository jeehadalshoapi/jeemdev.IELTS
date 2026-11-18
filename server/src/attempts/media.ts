/* Phase 6: speaking recordings (MediaRecorder uploads) and listening read-aloud lines. */
import { rm } from 'node:fs/promises';
import { listItems, partSpeech, RECORDING_MAX_BYTES, sectionSkillOf, speechPartIds, uploadKindOf, type RecordingInfo, type SpeechResponse } from '@ielts/shared';
import { and, eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import type { Db } from '../db/client';
import { attempts, files, tests, type FileRow } from '../db/schema';
import { EmptyFileError, FileTooLargeError, fileUrl, type FileStore } from '../files/store';
import { HttpError, notFound } from '../http/errors';
import { isUuid } from './service';

const info = (f: FileRow): RecordingInfo => ({
  id: f.id, url: fileUrl(f.id), mimeType: f.mimeType, sizeBytes: f.sizeBytes,
  durationSec: f.durationSec === null ? null : Math.round(f.durationSec), createdAt: f.createdAt.toISOString(),
  pausesOver3s: f.pausesOver3s, longestPauseSec: f.longestPauseSec, speakingSec: f.speakingSec,
  transcript: f.transcript, transcriptStatus: f.transcriptStatus
});

/** a number from the upload's query string, kept inside [0, max] */
const metric = (v: number | undefined, max: number) => (v !== undefined && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : null);

async function openAttempt(db: Db, attemptId: string) {
  if (!isUuid(attemptId)) throw notFound('Attempt not found');
  const [row] = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id)).where(eq(attempts.id, attemptId)).limit(1);
  if (!row) throw notFound('Attempt not found');
  return { a: row.attempts, t: row.tests };
}

async function removeFiles(db: Db, store: FileStore, rows: FileRow[]) {
  for (const f of rows) {
    await db.delete(files).where(eq(files.id, f.id));
    await rm(store.absolutePath(f.storagePath), { force: true });
  }
}

/** save a recording for one speaking item; an earlier recording of the same item is replaced */
export async function saveRecording(db: Db, store: FileStore, p: { attemptId: string; itemId: string; mimeType: string; durationSec?: number; pausesOver3s?: number; longestPauseSec?: number; speakingSec?: number; contentLength?: number; stream: Readable }): Promise<RecordingInfo> {
  const { a, t } = await openAttempt(db, p.attemptId);
  if (a.status !== 'in_progress') throw new HttpError(409, 'already_submitted', 'This attempt has been submitted, so recordings can no longer change.');
  const item = listItems(t.content.parts).find(i => i.id === p.itemId);
  if (!item || item.kind !== 'speaking') throw new HttpError(400, 'invalid_request', `"${p.itemId}" is not a speaking question of this test.`);
  if (uploadKindOf(p.mimeType) !== 'audio') throw new HttpError(415, 'unsupported_type', 'A recording must be audio (webm, ogg, mp4, mpeg or wav).');
  if ((p.contentLength ?? 0) > RECORDING_MAX_BYTES) throw new HttpError(413, 'too_large', `The recording is larger than ${RECORDING_MAX_BYTES / 1024 / 1024} MB.`);

  const earlier = await db.select().from(files).where(and(eq(files.attemptId, a.id), eq(files.itemId, p.itemId)));
  let saved;
  try {
    saved = await store.saveStream({ stream: p.stream, maxBytes: RECORDING_MAX_BYTES, originalName: `${p.itemId}.${p.mimeType.split(';')[0]!.split('/')[1] ?? 'webm'}`, mimeType: p.mimeType.split(';')[0]!.trim(), kind: 'recording', attemptId: a.id, testId: t.id });
  } catch (e) {
    if (e instanceof FileTooLargeError) throw new HttpError(413, 'too_large', `The recording is larger than ${RECORDING_MAX_BYTES / 1024 / 1024} MB.`);
    if (e instanceof EmptyFileError) throw new HttpError(400, 'empty_file', 'The recording is empty.');
    throw e;
  }
  const duration = p.durationSec !== undefined && Number.isFinite(p.durationSec) ? Math.max(0, Math.min(3600, p.durationSec)) : null;
  const [row] = await db.update(files).set({
    itemId: p.itemId, durationSec: duration,
    pausesOver3s: metric(p.pausesOver3s, 1000) === null ? null : Math.round(p.pausesOver3s!),
    longestPauseSec: metric(p.longestPauseSec, 3600), speakingSec: metric(p.speakingSec, 3600)
  }).where(eq(files.id, saved.id)).returning();
  await removeFiles(db, store, earlier);
  return info(row!);
}

export async function deleteRecording(db: Db, store: FileStore, attemptId: string, itemId: string): Promise<void> {
  const { a } = await openAttempt(db, attemptId);
  if (a.status !== 'in_progress') throw new HttpError(409, 'already_submitted', 'This attempt has been submitted, so recordings can no longer change.');
  await removeFiles(db, store, await db.select().from(files).where(and(eq(files.attemptId, a.id), eq(files.itemId, itemId))));
}

/**
 * The lines of a listening part that the browser reads aloud. The transcript stays off the page; it is sent only
 * here, only for parts without a recording, and in exam mode only the lines that have not been played yet.
 */
export async function speechFor(db: Db, attemptId: string, partId: string): Promise<SpeechResponse> {
  const { a, t } = await openAttempt(db, attemptId);
  const parts = t.content.parts;
  const part = parts.find(p => p.id === partId);
  if (!part || !speechPartIds(parts, p => sectionSkillOf(p, t.skill)).includes(partId) || !part.transcript) {
    throw new HttpError(404, 'not_found', 'This part has a recording (or no transcript), so there is nothing to read aloud.');
  }
  const numbers = listItems([part]).flatMap(i => i.numbers);
  const lines = partSpeech(part, numbers);
  const saved = (a.state[`tts:${partId}`] as { line?: unknown } | undefined)?.line;
  const from = a.mode === 'exam' && a.status === 'in_progress' && typeof saved === 'number' ? Math.max(0, Math.min(lines.length, Math.floor(saved))) : 0;
  return { partId, lines: lines.slice(from), from, total: lines.length };
}
