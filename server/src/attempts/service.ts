import {
  listItems, progressOf, scoreAnswers, toPublicContent, totalMarks, AttemptPatch,
  type AnswerValue, type AttemptMode, type AttemptSummary, type AttemptView, type AutoScore, type PublicTest, type ResultView,
  type DictationPlay, type RecordingInfo, type SaveResult, type TestContent, type Timing
} from '@ielts/shared';
import { recordMasteryAttempt } from '../study/mastery';
import { tickTestBlocks } from '../study/plan';
import { logVocabQuiz } from '../study/vocab-quiz';
import { and, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attempts, files, tests, type AttemptRow, type TestRow } from '../db/schema';
import { HttpError, notFound } from '../http/errors';

/** answers that arrive this long after the exam deadline are still accepted (network delay) */
export const EXAM_GRACE_SEC = 30;
const MAX_STATE_BYTES = 300_000;
const MAX_DEVICES = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

/* ---------- clock ---------- */
export function computeTiming(a: Pick<AttemptRow, 'mode' | 'startedAt' | 'submittedAt' | 'timeSpentSec'>, content: TestContent, now = new Date()): Timing {
  const limitSec = content.timeLimitMin ? Math.round(content.timeLimitMin * 60) : null;
  const spentSec: Record<string, number> = { total: 0, ...(a.timeSpentSec ?? {}) };
  let remainingSec: number | null = null;
  let deadline: string | null = null;
  if (limitSec !== null) {
    if (a.mode === 'exam') {
      // exam mode runs on the wall clock, like the real test: it keeps going while the browser is closed
      const end = new Date(a.startedAt.getTime() + limitSec * 1000);
      deadline = end.toISOString();
      remainingSec = Math.round((end.getTime() - (a.submittedAt ?? now).getTime()) / 1000);
    } else {
      // practice mode counts only the time you actually spend in the test
      remainingSec = limitSec - Math.round(spentSec.total ?? 0);
    }
  }
  return { limitSec, remainingSec, deadline, serverNow: now.toISOString(), spentSec };
}

function examExpired(a: AttemptRow, content: TestContent, now: Date): Date | null {
  if (a.mode !== 'exam' || a.status !== 'in_progress' || !content.timeLimitMin) return null;
  const deadline = new Date(a.startedAt.getTime() + content.timeLimitMin * 60_000);
  return now.getTime() > deadline.getTime() + EXAM_GRACE_SEC * 1000 ? deadline : null;
}

/* ---------- scoring ---------- */
export function scoreFor(answers: Record<string, unknown>, t: TestRow): AutoScore {
  return scoreAnswers(t.skill, t.content, t.answerKey, answers);
}

/** submit an exam attempt whose clock ran out (submitted at the deadline, with the answers saved so far) */
async function autoSubmitIfExpired(db: Db, a: AttemptRow, t: TestRow, now = new Date()): Promise<AttemptRow> {
  const deadline = examExpired(a, t.content, now);
  if (!deadline) return a;
  const [row] = await db.update(attempts)
    .set({ status: 'submitted', submittedAt: deadline, updatedAt: now, state: { ...a.state, autoSubmitted: true }, autoScore: scoreFor(a.answers, t) as unknown as Record<string, unknown> })
    .where(and(eq(attempts.id, a.id), eq(attempts.status, 'in_progress')))
    .returning();
  return row ?? a;
}

/** re-score every submitted attempt of a test (after its answer key changed) */
export async function rescoreTestAttempts(db: Db, testId: string): Promise<number> {
  const [t] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!t) return 0;
  const rows = await db.select().from(attempts).where(and(eq(attempts.testId, testId), ne(attempts.status, 'in_progress')));
  for (const a of rows) {
    await db.update(attempts).set({ autoScore: scoreFor(a.answers, t) as unknown as Record<string, unknown> }).where(eq(attempts.id, a.id));
    if (t.content.masteryStepId) await recordMasteryAttempt(db, a.id).catch(e => console.error('[mastery] could not re-record', e));
  }
  return rows.length;
}

/* ---------- views ---------- */
export function publicTest(t: TestRow, opts: { withTranscripts?: boolean } = {}): PublicTest {
  return {
    id: t.id, title: t.title, skill: t.skill, kind: t.kind, status: t.status,
    instructions: t.instructions, dueDate: t.dueDate,
    content: opts.withTranscripts ? t.content : toPublicContent(t.content),
    marks: totalMarks(t.content.parts)
  };
}

export function summarize(a: AttemptRow, t: TestRow, now = new Date()): AttemptSummary {
  const auto = a.autoScore as { raw?: number; total?: number; band?: number | null } | null;
  const progress = progressOf(a.answers, t.content.parts);
  return {
    id: a.id, testId: t.id, title: t.title, skill: t.skill, kind: t.kind, mode: a.mode, status: a.status,
    startedAt: a.startedAt.toISOString(), updatedAt: a.updatedAt.toISOString(), submittedAt: a.submittedAt?.toISOString() ?? null,
    answered: progress.answered,
    items: progress.total,
    timing: computeTiming(a, t.content, now),
    feedbackReady: a.feedback !== null,
    feedbackBand: typeof a.feedback?.overallBand === 'number' ? a.feedback.overallBand : null,
    autoScore: auto ? { raw: auto.raw, total: auto.total, band: auto.band ?? null } : null
  };
}

async function loadPair(db: Db, attemptId: string): Promise<{ a: AttemptRow; t: TestRow }> {
  if (!isUuid(attemptId)) throw notFound('Attempt not found');
  const [row] = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id)).where(eq(attempts.id, attemptId)).limit(1);
  if (!row) throw notFound('Attempt not found');
  return { a: row.attempts, t: row.tests };
}

export async function createAttempt(db: Db, testId: string, mode: AttemptMode, device?: { id?: string; ua?: string }): Promise<string> {
  if (!isUuid(testId)) throw notFound('Test not found');
  const [t] = await db.select({ id: tests.id }).from(tests).where(eq(tests.id, testId)).limit(1);
  if (!t) throw notFound('Test not found');
  const now = new Date().toISOString();
  const deviceLog = device?.id ? [{ id: device.id, ua: device.ua ?? '', firstSeen: now, lastSeen: now, saves: 0 }] : [];
  const [row] = await db.insert(attempts).values({ testId, mode, deviceLog }).returning({ id: attempts.id });
  if (!row) throw new Error('insert returned no row');
  return row.id;
}

export async function getAttemptView(db: Db, attemptId: string): Promise<AttemptView> {
  const now = new Date();
  const { a: raw, t } = await loadPair(db, attemptId);
  const a = await autoSubmitIfExpired(db, raw, t, now);
  return {
    attempt: {
      id: a.id, testId: a.testId, status: a.status, mode: a.mode,
      answers: a.answers as Record<string, AnswerValue>, state: a.state,
      startedAt: a.startedAt.toISOString(), submittedAt: a.submittedAt?.toISOString() ?? null,
      autoSubmitted: a.state.autoSubmitted === true
    },
    test: publicTest(t),
    timing: computeTiming(a, t.content, now),
    recordings: await recordingsOf(db, a.id)
  };
}

/** the latest recording of each speaking item of an attempt */
export async function recordingsOf(db: Db, attemptId: string): Promise<Record<string, RecordingInfo>> {
  const rows = await db.select().from(files).where(and(eq(files.attemptId, attemptId), isNotNull(files.itemId))).orderBy(desc(files.createdAt));
  const out: Record<string, RecordingInfo> = {};
  for (const f of rows) {
    if (!f.itemId || out[f.itemId]) continue;
    out[f.itemId] = {
      id: f.id, url: `/files/${f.id}`, mimeType: f.mimeType, sizeBytes: f.sizeBytes, durationSec: f.durationSec === null ? null : Math.round(f.durationSec), createdAt: f.createdAt.toISOString(),
      pausesOver3s: f.pausesOver3s, longestPauseSec: f.longestPauseSec, speakingSec: f.speakingSec, transcript: f.transcript, transcriptStatus: f.transcriptStatus
    };
  }
  return out;
}

/* ---------- saving ---------- */
function checkAnswers(answers: Record<string, unknown>, content: TestContent): void {
  const items = new Map(listItems(content.parts).map(i => [i.id, i]));
  const issues: Array<{ path: string; message: string }> = [];
  for (const [id, v] of Object.entries(answers)) {
    const item = items.get(id);
    if (!item) { issues.push({ path: `answers.${id}`, message: 'no question with this id in the test' }); continue; }
    if (v === null) continue;
    const ok = item.type === 'mcq_multi' ? Array.isArray(v)
      : item.type === 'writing_task2' ? typeof v === 'string' || (typeof v === 'object' && !Array.isArray(v))
      : typeof v === 'string';
    if (!ok) issues.push({ path: `answers.${id}`, message: `wrong kind of answer for a ${item.type} question` });
  }
  if (issues.length) throw new HttpError(400, 'invalid_answers', 'Some answers do not match the test.', issues);
}

type DeviceEntry = { id: string; ua: string; firstSeen: string; lastSeen: string; saves: number };

function logDevice(log: unknown[], deviceId: string | undefined, ua: string | undefined, nowIso: string): DeviceEntry[] {
  const list = (Array.isArray(log) ? log : []) as DeviceEntry[];
  if (!deviceId) return list;
  const existing = list.find(d => d.id === deviceId);
  if (existing) return list.map(d => (d.id === deviceId ? { ...d, ua: ua?.slice(0, 200) ?? d.ua, lastSeen: nowIso, saves: d.saves + 1 } : d));
  return [...list, { id: deviceId, ua: ua?.slice(0, 200) ?? '', firstSeen: nowIso, lastSeen: nowIso, saves: 1 }].slice(-MAX_DEVICES);
}

/**
 * Apply an autosave. Only the answers / state keys that changed are sent, and they are merged into what is
 * stored, so two devices never wipe each other's answers. Active time is capped by the real time elapsed.
 */
export async function saveAttempt(db: Db, attemptId: string, body: unknown, ua?: string, opts: { submit?: boolean } = {}): Promise<SaveResult> {
  const r = await saveInTransaction(db, attemptId, body, ua, opts);
  if (opts.submit) await afterSubmit(db, attemptId);
  return r;
}

/** follow-ups of a submission that must never fail it (vocabulary quiz -> self-test log) */
async function afterSubmit(db: Db, attemptId: string): Promise<void> {
  try { await logVocabQuiz(db, attemptId); } catch (e) { console.error('[vocab] could not log the quiz', e); }
  try { await recordMasteryAttempt(db, attemptId); } catch (e) { console.error('[mastery] could not record the attempt', e); }
  try {
    const [a] = await db.select({ testId: attempts.testId }).from(attempts).where(eq(attempts.id, attemptId)).limit(1);
    if (a) await tickTestBlocks(db, a.testId);
  } catch (e) { console.error('[plan] could not tick the block', e); }
}

async function saveInTransaction(db: Db, attemptId: string, body: unknown, ua?: string, opts: { submit?: boolean } = {}): Promise<SaveResult> {
  const patch = AttemptPatch.parse(body ?? {});
  return db.transaction(async tx => {
    const { a: current, t } = await loadPair(tx as unknown as Db, attemptId);
    const now = new Date();
    const a = await autoSubmitIfExpired(tx as unknown as Db, current, t, now);
    if (a.status !== 'in_progress') {
      throw new HttpError(409, a.state.autoSubmitted ? 'time_up' : 'already_submitted',
        a.state.autoSubmitted ? 'Time is up — this attempt was submitted automatically.' : 'This attempt has already been submitted.');
    }
    if (patch.answers) checkAnswers(patch.answers, t.content);

    const answers = { ...a.answers, ...(patch.answers ?? {}) };
    // dictation play counts are kept by the server only (playDictation)
    const changedState = Object.fromEntries(Object.entries(patch.state ?? {}).filter(([k]) => !k.startsWith('dict:')));
    const state = { ...a.state, ...changedState };
    if (JSON.stringify(state).length > MAX_STATE_BYTES) throw new HttpError(413, 'too_large', 'Too many highlights or notes to save.');

    const spent: Record<string, number> = { total: 0, ...a.timeSpentSec };
    if (patch.activeSec) {
      const partIds = new Set(t.content.parts.map(p => p.id));
      // never count more active time than real time has passed since the last save (+ a little slack)
      let budget = Math.max(0, (now.getTime() - a.updatedAt.getTime()) / 1000 + 5);
      for (const [partId, secs] of Object.entries(patch.activeSec)) {
        if (!partIds.has(partId)) continue;
        const add = Math.min(secs, budget);
        budget -= add;
        spent[partId] = Math.round(((spent[partId] ?? 0) + add) * 10) / 10;
        spent.total = Math.round(((spent.total ?? 0) + add) * 10) / 10;
      }
    }

    const deadline = a.mode === 'exam' && t.content.timeLimitMin ? new Date(a.startedAt.getTime() + t.content.timeLimitMin * 60_000) : null;
    const submittedAt = opts.submit ? (deadline && now > deadline ? deadline : now) : null;
    const [row] = await tx.update(attempts).set({
      answers, state, timeSpentSec: spent, updatedAt: now,
      deviceLog: logDevice(a.deviceLog, patch.device, ua, now.toISOString()),
      ...(opts.submit ? { status: 'submitted' as const, submittedAt, autoScore: scoreFor(answers, t) as unknown as Record<string, unknown> } : {})
    }).where(eq(attempts.id, a.id)).returning();
    if (!row) throw new Error('update returned no row');
    return { status: row.status, savedAt: now.toISOString(), timing: computeTiming(row, t.content, now) };
  });
}

/* ---------- discarding an attempt that was started by mistake ---------- */
/** deletes an attempt that is still in progress (answers, notes, recordings); submitted attempts are kept */
export async function discardAttempt(db: Db, attemptId: string, removeFile: (storagePath: string) => Promise<void>): Promise<{ testId: string }> {
  const { a } = await loadPair(db, attemptId);
  if (a.status !== 'in_progress') throw new HttpError(409, 'already_submitted', 'Only an attempt that is still in progress can be discarded. Submitted attempts stay in your history.');
  const recs = await db.select().from(files).where(eq(files.attemptId, a.id));
  for (const f of recs) {
    await db.delete(files).where(eq(files.id, f.id));
    await removeFile(f.storagePath).catch(e => console.error('[discard] could not remove a file', e));
  }
  await db.delete(attempts).where(and(eq(attempts.id, a.id), eq(attempts.status, 'in_progress')));
  console.log(`[attempt] ${a.id} discarded`);
  return { testId: a.testId };
}

/* ---------- dictation: the server reads out each word at most maxPlays times ---------- */
export async function playDictation(db: Db, attemptId: string, questionId: string): Promise<DictationPlay> {
  return db.transaction(async tx => {
    const { a: current, t } = await loadPair(tx as unknown as Db, attemptId);
    const a = await autoSubmitIfExpired(tx as unknown as Db, current, t, new Date());
    for (const part of t.content.parts) for (const g of part.questionGroups) {
      if (g.type !== 'dictation') continue;
      const q = g.questions.find(x => x.id === questionId);
      if (!q) continue;
      const lines = [...(q.sentence ? [q.sentence] : []), q.say];
      const key = `dict:${q.id}`;
      const used = typeof a.state[key] === 'number' ? (a.state[key] as number) : 0;
      // after submission (review) the word can be heard again freely
      if (a.status !== 'in_progress') return { lines, playsLeft: g.maxPlays, maxPlays: g.maxPlays };
      if (used >= g.maxPlays) throw new HttpError(409, 'no_plays_left', `You have heard this word ${g.maxPlays === 1 ? 'once' : `${g.maxPlays} times`} already.`);
      await tx.update(attempts).set({ state: sql`${attempts.state} || ${JSON.stringify({ [key]: used + 1 })}::jsonb` }).where(eq(attempts.id, a.id));
      return { lines, playsLeft: g.maxPlays - used - 1, maxPlays: g.maxPlays };
    }
    throw notFound('This test has no dictation question with that id.');
  });
}

/* ---------- lists ---------- */
export async function listAttemptSummaries(db: Db, opts: { testId?: string; limit?: number } = {}): Promise<AttemptSummary[]> {
  const now = new Date();
  const rows = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id))
    .where(opts.testId ? eq(attempts.testId, opts.testId) : undefined)
    .orderBy(desc(attempts.updatedAt)).limit(opts.limit ?? 200);
  const out: AttemptSummary[] = [];
  for (const r of rows) {
    const a = await autoSubmitIfExpired(db, r.attempts, r.tests, now);
    out.push(summarize(a, r.tests, now));
  }
  return out;
}

/* ---------- results (only after submission) ---------- */
export async function getResultView(db: Db, attemptId: string): Promise<ResultView> {
  const now = new Date();
  const { a: raw, t } = await loadPair(db, attemptId);
  let a = await autoSubmitIfExpired(db, raw, t, now);
  if (a.status === 'in_progress') throw new HttpError(409, 'not_submitted', 'Results are available after you submit the attempt.');
  if (t.content.vocabularySetId) await afterSubmit(db, a.id); // an exam quiz the server submitted when time ran out
  else if (t.content.masteryStepId) await recordMasteryAttempt(db, a.id).catch(e => console.error('[mastery] could not record the attempt', e));
  let autoScore = a.autoScore as unknown as AutoScore | null;
  if (!autoScore || autoScore.version !== 1) {
    // attempts submitted before scoring existed: score them now and keep the result
    autoScore = scoreFor(a.answers, t);
    const [row] = await db.update(attempts).set({ autoScore: autoScore as unknown as Record<string, unknown> }).where(eq(attempts.id, a.id)).returning();
    if (row) a = row;
  }
  const modelAnswers: Record<string, string> = {};
  for (const [id, entry] of Object.entries(t.answerKey)) if (entry.modelAnswer) modelAnswers[id] = entry.modelAnswer;
  const timeUsedSec = a.mode === 'exam' && a.submittedAt
    ? Math.max(0, Math.round((a.submittedAt.getTime() - a.startedAt.getTime()) / 1000))
    : Math.round(Number(a.timeSpentSec.total ?? 0));
  return {
    attempt: {
      id: a.id, testId: a.testId, status: a.status, mode: a.mode,
      answers: a.answers as Record<string, AnswerValue>, state: a.state,
      startedAt: a.startedAt.toISOString(), submittedAt: a.submittedAt?.toISOString() ?? null,
      autoSubmitted: a.state.autoSubmitted === true, timeUsedSec, timeSpentSec: a.timeSpentSec
    },
    test: publicTest(t, { withTranscripts: true }),
    autoScore,
    modelAnswers,
    feedback: a.feedback,
    recordings: await recordingsOf(db, a.id)
  };
}
