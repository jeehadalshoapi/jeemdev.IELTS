/*
 * Lessons, vocabulary bank and mistakes log (Phase 8). Used by the website API and by the MCP tools,
 * so both apply the same rules (dedupe of mistakes, word status after a quiz, mastered after 3 reviews).
 */
import {
  Lesson, MASTERED_AFTER, MistakeInput, MistakePatch, pairKey, VocabResult, VocabSet, WORD_STATUSES,
  type LessonSummary, type LessonView, type MistakeCategory, type MistakeRow, type VocabResultRow, type VocabSetSummary,
  type VocabSetView, type VocabWordRow, type WordStatus
} from '@ielts/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client';
import { lessons, mistakes, tests, vocabResults, vocabSets } from '../db/schema';
import { HttpError } from '../http/errors';

/* ---------------------------------------------------------------- lessons */

const lessonSummary = (r: typeof lessons.$inferSelect): LessonSummary => ({
  id: r.id, title: r.title, day: r.day, week: r.week, skill: r.skill, kind: r.kind,
  summary: r.document.summary ?? null, updatedAt: r.updatedAt.toISOString()
});

function lessonColumns(l: Lesson) {
  return { title: l.title, day: l.day ?? null, week: l.week ?? null, skill: l.skill ?? null, kind: l.kind, document: l };
}

/** throws a zod error (with paths) when the lesson is not valid */
export async function saveLesson(db: Db, input: unknown, mode: 'create' | 'replace'): Promise<{ lesson: Lesson; created: boolean }> {
  const lesson = Lesson.parse(input);
  const [existing] = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, lesson.id)).limit(1);
  if (existing && mode === 'create') throw new HttpError(409, 'exists', `A lesson with id "${lesson.id}" already exists. Use update_lesson to change it, or choose another id.`);
  if (!existing && mode === 'replace') throw new HttpError(404, 'not_found', `There is no lesson with id "${lesson.id}". Use create_lesson.`);
  if (existing) await db.update(lessons).set({ ...lessonColumns(lesson), updatedAt: new Date() }).where(eq(lessons.id, lesson.id));
  else await db.insert(lessons).values({ id: lesson.id, ...lessonColumns(lesson) });
  return { lesson, created: !existing };
}

/** top-level fields replace (null removes one); the id cannot change */
export async function updateLesson(db: Db, id: string, changes: Record<string, unknown>): Promise<Lesson> {
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
  if (!row) throw new HttpError(404, 'not_found', `There is no lesson with id "${id}". Use list_lessons to find it.`);
  const next: Record<string, unknown> = { ...row.document };
  for (const [k, v] of Object.entries(changes)) { if (k === 'id') continue; if (v === null) delete next[k]; else next[k] = v; }
  return (await saveLesson(db, next, 'replace')).lesson;
}

export async function listLessons(db: Db, f: { week?: string; day?: number; skill?: string; kind?: string } = {}): Promise<LessonSummary[]> {
  const rows = await db.select().from(lessons).orderBy(asc(lessons.day), asc(lessons.title));
  return rows.filter(r => (f.week === undefined || r.week?.toLowerCase() === f.week.toLowerCase()) && (f.day === undefined || r.day === f.day)
    && (f.skill === undefined || r.skill === f.skill) && (f.kind === undefined || r.kind === f.kind)).map(lessonSummary);
}

export async function getLesson(db: Db, id: string): Promise<LessonView | null> {
  const [row] = await db.select().from(lessons).where(eq(lessons.id, id)).limit(1);
  if (!row) return null;
  const testIds = row.document.relatedTestIds ?? [];
  const setIds = row.document.vocabularySetIds ?? [];
  const testRows = testIds.length ? await db.select({ id: tests.id, title: tests.title, skill: tests.skill, status: tests.status }).from(tests).where(inArray(tests.id, testIds)) : [];
  const setRows = setIds.length ? await db.select({ id: vocabSets.id, theme: vocabSets.theme, number: vocabSets.number }).from(vocabSets).where(inArray(vocabSets.id, setIds)) : [];
  return {
    lesson: row.document, updatedAt: row.updatedAt.toISOString(),
    tests: testIds.map(i => testRows.find(t => t.id === i)).filter(t => !!t),
    vocabularySets: setIds.map(i => setRows.find(s => s.id === i)).filter(s => !!s)
  };
}

/* ---------------------------------------------------------------- vocabulary */

const wordKey = (w: string) => w.trim().toLowerCase();
const resultRow = (r: typeof vocabResults.$inferSelect): VocabResultRow => ({
  id: r.id, setId: r.setId, quiz: r.quiz, date: r.date, score: r.score, total: r.total, weakWords: r.weakWords, attemptId: r.attemptId
});

/**
 * Creates or replaces a set. Words keep their status and miss count when the new list repeats them
 * (unless the input sets them); words left out of the list are removed.
 */
export async function upsertVocabSet(db: Db, input: unknown): Promise<{ id: string; created: boolean; words: number }> {
  const s = VocabSet.parse(input);
  const [existing] = await db.select().from(vocabSets).where(eq(vocabSets.id, s.id)).limit(1);
  const old = new Map((existing?.words ?? []).map(w => [wordKey(w.word), w]));
  const words: VocabWordRow[] = s.words.map(w => {
    const prev = old.get(wordKey(w.word));
    return { ...w, status: w.status ?? prev?.status ?? 'new', timesMissed: w.timesMissed ?? prev?.timesMissed ?? 0 };
  });
  const cols = { number: s.number ?? null, theme: s.theme, studyDay: s.studyDay ?? null, words };
  if (existing) await db.update(vocabSets).set({ ...cols, updatedAt: new Date() }).where(eq(vocabSets.id, s.id));
  else await db.insert(vocabSets).values({ id: s.id, ...cols });
  return { id: s.id, created: !existing, words: words.length };
}

export async function listVocabSets(db: Db): Promise<VocabSetSummary[]> {
  const rows = await db.select().from(vocabSets).orderBy(asc(vocabSets.number), asc(vocabSets.id));
  const results = await db.select().from(vocabResults).orderBy(desc(vocabResults.date), desc(vocabResults.createdAt));
  return rows.map(r => {
    const byStatus = Object.fromEntries(WORD_STATUSES.map(s => [s, 0])) as Record<WordStatus, number>;
    for (const w of r.words) byStatus[w.status]++;
    const last = results.find(x => x.setId === r.id);
    return { id: r.id, number: r.number, theme: r.theme, studyDay: r.studyDay, words: r.words.length, byStatus, lastResult: last ? resultRow(last) : null, updatedAt: r.updatedAt.toISOString() };
  });
}

export async function getVocabSet(db: Db, id: string): Promise<VocabSetView | null> {
  const [r] = await db.select().from(vocabSets).where(eq(vocabSets.id, id)).limit(1);
  if (!r) return null;
  const results = await db.select().from(vocabResults).where(eq(vocabResults.setId, id)).orderBy(desc(vocabResults.date), desc(vocabResults.createdAt));
  const linked = await db.select({ id: tests.id, title: tests.title, status: tests.status, content: tests.content }).from(tests)
    .where(sql`${tests.content}->>'vocabularySetId' = ${id}`).orderBy(desc(tests.createdAt));
  return {
    set: { id: r.id, number: r.number, theme: r.theme, studyDay: r.studyDay, words: r.words },
    results: results.map(resultRow),
    tests: linked.map(t => ({ id: t.id, title: t.title, status: t.status }))
  };
}

/** changes one word; `status` / `timesMissed` as given, other fields (meaning, example …) replace */
export async function updateWord(db: Db, setId: string, word: string, changes: Partial<VocabWordRow>): Promise<VocabWordRow> {
  const [r] = await db.select().from(vocabSets).where(eq(vocabSets.id, setId)).limit(1);
  if (!r) throw new HttpError(404, 'not_found', `There is no vocabulary set "${setId}". Use list_vocab_sets.`);
  const i = r.words.findIndex(w => wordKey(w.word) === wordKey(word));
  if (i < 0) throw new HttpError(404, 'not_found', `"${word}" is not in set "${setId}". Its words: ${r.words.map(w => w.word).join(', ')}`);
  const next = { ...r.words[i]!, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)), word: r.words[i]!.word } as VocabWordRow;
  const words = r.words.map((w, j) => (j === i ? next : w));
  await db.update(vocabSets).set({ words, updatedAt: new Date() }).where(eq(vocabSets.id, setId));
  return next;
}

/**
 * Adds a line to the self-test log. Weak words are marked "weak" and their miss count goes up;
 * with `markOthers`, the set's other tested words move on (new/weak -> learning, learning -> learned).
 */
export async function recordVocabResult(db: Db, input: unknown, opts: { tested?: string[] } = {}): Promise<{ result: VocabResultRow; weakMarked: string[]; unknownWords: string[] }> {
  const v = VocabResult.parse(input);
  const [r] = await db.select().from(vocabSets).where(eq(vocabSets.id, v.setId)).limit(1);
  if (!r) throw new HttpError(404, 'not_found', `There is no vocabulary set "${v.setId}". Create it first with upsert_vocab_set.`);
  const weak = new Set((v.weakWords ?? []).map(wordKey));
  const tested = new Set((opts.tested ?? []).map(wordKey));
  const known = new Set(r.words.map(w => wordKey(w.word)));
  const words = r.words.map(w => {
    const k = wordKey(w.word);
    if (weak.has(k)) return { ...w, status: 'weak' as const, timesMissed: w.timesMissed + 1 };
    if (tested.has(k)) return { ...w, status: (w.status === 'learning' ? 'learned' : w.status === 'learned' ? 'learned' : 'learning') as WordStatus };
    return w;
  });
  await db.update(vocabSets).set({ words, updatedAt: new Date() }).where(eq(vocabSets.id, v.setId));
  const [row] = await db.insert(vocabResults).values({
    setId: v.setId, quiz: v.quiz ?? null, date: v.date, score: v.score, total: v.total, weakWords: v.weakWords ?? [], attemptId: v.attemptId ?? null
  }).returning();
  return {
    result: resultRow(row!),
    weakMarked: r.words.filter(w => weak.has(wordKey(w.word))).map(w => w.word),
    unknownWords: (v.weakWords ?? []).filter(w => !known.has(wordKey(w)))
  };
}

/* ---------------------------------------------------------------- mistakes log */

const mistakeRow = (m: typeof mistakes.$inferSelect): MistakeRow => ({
  id: m.id, category: m.category, wrong: m.wrong, correct: m.correct, rule: m.rule, arabic: m.arabic, source: m.source,
  timesWrong: m.timesWrong, neverAgain: m.neverAgain, streak: m.streak, status: m.status, lastReviewedOn: m.lastReviewedOn,
  createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString()
});

/**
 * Adds entries with dedupe: the same wrong -> correct pair (any capitals or spacing) is counted again instead of
 * duplicated (timesWrong + 1, a mastered entry becomes active again). At 2 or more, neverAgain is set.
 */
export async function addMistakes(db: Db, inputs: Array<z.input<typeof MistakeInput>>): Promise<{ added: MistakeRow[]; repeated: MistakeRow[] }> {
  const added: MistakeRow[] = [], repeated: MistakeRow[] = [];
  for (const raw of inputs) {
    const m = MistakeInput.parse(raw);
    const key = pairKey(m.wrong, m.correct);
    const [old] = await db.select().from(mistakes).where(eq(mistakes.pairKey, key)).limit(1);
    if (old) {
      const timesWrong = old.timesWrong + 1;
      const [row] = await db.update(mistakes).set({
        timesWrong, neverAgain: m.neverAgain ?? (old.neverAgain || timesWrong >= 2), status: 'active', streak: 0,
        rule: m.rule ?? old.rule, arabic: m.arabic ?? old.arabic, source: m.source ?? old.source, updatedAt: new Date()
      }).where(eq(mistakes.id, old.id)).returning();
      repeated.push(mistakeRow(row!));
    } else {
      const timesWrong = m.timesWrong ?? 1;
      const [row] = await db.insert(mistakes).values({
        category: m.category, wrong: m.wrong.trim(), correct: m.correct.trim(), pairKey: key, rule: m.rule ?? null, arabic: m.arabic ?? null,
        source: m.source ?? null, timesWrong, neverAgain: m.neverAgain ?? timesWrong >= 2
      }).returning();
      added.push(mistakeRow(row!));
    }
  }
  return { added, repeated };
}

export async function listMistakes(db: Db, f: { category?: MistakeCategory; status?: 'active' | 'mastered'; neverAgain?: boolean; limit?: number } = {}): Promise<MistakeRow[]> {
  const where = and(
    f.category ? eq(mistakes.category, f.category) : undefined,
    f.status ? eq(mistakes.status, f.status) : undefined,
    f.neverAgain !== undefined ? eq(mistakes.neverAgain, f.neverAgain) : undefined
  );
  const rows = await db.select().from(mistakes).where(where).orderBy(desc(mistakes.neverAgain), desc(mistakes.timesWrong), asc(mistakes.wrong)).limit(f.limit ?? 2000);
  return rows.map(mistakeRow);
}

export async function updateMistake(db: Db, id: string, input: unknown): Promise<MistakeRow> {
  const p = MistakePatch.parse(input);
  const [old] = await db.select().from(mistakes).where(eq(mistakes.id, id)).limit(1);
  if (!old) throw new HttpError(404, 'not_found', `There is no mistake with id ${id}. Use list_mistakes.`);
  const wrong = p.wrong ?? old.wrong, correct = p.correct ?? old.correct;
  const key = pairKey(wrong, correct);
  if (key !== old.pairKey) {
    const [clash] = await db.select({ id: mistakes.id }).from(mistakes).where(eq(mistakes.pairKey, key)).limit(1);
    if (clash) throw new HttpError(409, 'exists', `Another entry already has "${wrong}" → "${correct}" (id ${clash.id}).`);
  }
  const streak = p.streak ?? old.streak;
  const [row] = await db.update(mistakes).set({
    ...p, wrong, correct, pairKey: key, streak,
    status: p.status ?? (streak >= MASTERED_AFTER ? 'mastered' : old.status),
    updatedAt: new Date()
  }).where(eq(mistakes.id, id)).returning();
  return mistakeRow(row!);
}

/**
 * One answer in the daily review. Right: the streak goes up once per day, and at 3 the entry is mastered.
 * Wrong: the streak starts again (the count of real mistakes does not change).
 */
export async function reviewMistake(db: Db, id: string, correct: boolean, today: string): Promise<MistakeRow> {
  const [old] = await db.select().from(mistakes).where(eq(mistakes.id, id)).limit(1);
  if (!old) throw new HttpError(404, 'not_found', 'Mistake not found');
  const streak = correct ? (old.lastReviewedOn === today && old.streak > 0 ? old.streak : old.streak + 1) : 0;
  const [row] = await db.update(mistakes).set({
    streak, lastReviewedOn: today, status: streak >= MASTERED_AFTER ? 'mastered' : 'active', updatedAt: new Date()
  }).where(eq(mistakes.id, id)).returning();
  return mistakeRow(row!);
}
