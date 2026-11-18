/*
 * Vocabulary quizzes (Phase 9, ielts-site-spec.md item 4):
 * - a submitted test with "vocabularySetId" writes its score into that set's self-test log, missed words become "weak"
 *   and the words answered right move on (new/weak -> learning -> learned);
 * - "Test me" on a set page builds a quiz from the set (word -> meaning, word -> opposite).
 */
import { letter, type AutoScore, type QuestionGroup, type TestDocumentInput } from '@ielts/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attempts, tests, vocabResults, vocabSets } from '../db/schema';
import { HttpError } from '../http/errors';
import { createTest } from '../tests/repository';
import { recordVocabResult } from './store';

const norm = (s: string) => s.trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** the set word a question is about: its text is the word, or contains it, or the answer is the word */
export function wordOfQuestion(text: string, accept: string[], words: string[]): string | null {
  const t = norm(text);
  const exact = words.find(w => norm(w) === t);
  if (exact) return exact;
  const inside = words.filter(w => new RegExp(`(^|[^\\p{L}])${escapeRe(norm(w))}([^\\p{L}]|$)`, 'u').test(t));
  if (inside.length === 1) return inside[0]!;
  // "(to) alleviate" -> "alleviate": optional words in brackets are left out
  return words.find(w => accept.some(a => norm(a.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ')) === norm(w))) ?? null;
}

/** called after an attempt is submitted; does nothing for other tests or when it is already logged */
export async function logVocabQuiz(db: Db, attemptId: string): Promise<void> {
  const [row] = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id)).where(eq(attempts.id, attemptId)).limit(1);
  const setId = row?.tests.content.vocabularySetId;
  if (!row || !setId || row.attempts.status === 'in_progress') return;
  const [set] = await db.select().from(vocabSets).where(eq(vocabSets.id, setId)).limit(1);
  if (!set) return;
  const [done] = await db.select({ id: vocabResults.id }).from(vocabResults).where(and(eq(vocabResults.setId, setId), eq(vocabResults.attemptId, attemptId))).limit(1);
  if (done) return;
  const score = row.attempts.autoScore as unknown as AutoScore | null;
  if (!score || !score.total) return;

  const texts = new Map<string, string>();
  for (const p of row.tests.content.parts) for (const g of p.questionGroups) {
    if ('questions' in g) for (const q of g.questions as Array<{ id: string; text?: string }>) texts.set(q.id, q.text ?? '');
  }
  const words = set.words.map(w => w.word);
  const missed = new Set<string>(), tested = new Set<string>();
  for (const q of score.questions) {
    const w = wordOfQuestion(texts.get(q.questionId) ?? '', q.correctAnswers, words);
    if (!w) continue;
    tested.add(w);
    if (!q.correct) missed.add(w);
  }
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(vocabResults).where(eq(vocabResults.setId, setId));
  const date = (row.attempts.submittedAt ?? new Date()).toISOString().slice(0, 10);
  await recordVocabResult(db, { setId, quiz: Number(n) + 1, date, score: score.raw, total: score.total, weakWords: [...missed], attemptId },
    { tested: [...tested].filter(w => !missed.has(w)) });
  console.log(`[vocab] ${setId} quiz from attempt ${attemptId}: ${score.raw}/${score.total}, ${missed.size} weak`);
}

const shuffle = <T>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
};

/**
 * "Test me": a quiz from the set — up to 10 words with a meaning (weak first, learned last) and up to 6 with an
 * opposite. An open quiz of this set that has no attempt yet is reused instead of making another.
 */
export async function makeQuiz(db: Db, setId: string): Promise<{ testId: string; reused: boolean }> {
  const [set] = await db.select().from(vocabSets).where(eq(vocabSets.id, setId)).limit(1);
  if (!set) throw new HttpError(404, 'not_found', 'Vocabulary set not found');
  const open = await db.select({ id: tests.id }).from(tests)
    .where(and(eq(tests.status, 'assigned'), sql`${tests.content}->>'vocabularySetId' = ${setId}`, sql`${tests.instructions} = 'Made by Test me'`,
      sql`not exists (select 1 from ${attempts} where ${attempts.testId} = ${tests.id})`)).limit(1);
  if (open[0]) return { testId: open[0].id, reused: true };

  const rank = { weak: 0, new: 1, learning: 2, learned: 3 } as const;
  const order = shuffle(set.words).sort((a, b) => rank[a.status] - rank[b.status]);
  const withMeaning = order.filter(w => w.meaning?.trim()).slice(0, 10);
  const withOpposite = order.filter(w => w.opposite?.trim()).slice(0, 6);
  if (withMeaning.length < 2 && withOpposite.length < 2) throw new HttpError(400, 'too_few', 'This set needs at least 2 words with a meaning (or 2 with an opposite) to make a quiz.');

  let n = 0;
  const groups: QuestionGroup[] = [];
  const answerKey: Record<string, { accept: string[] }> = {};
  const group = (type: 'definition_match' | 'opposite_match', list: typeof order, field: 'meaning' | 'opposite') => {
    if (list.length < 2) return;
    const opts = shuffle(list.map(w => w[field]!.trim()));
    const gid = `${type === 'definition_match' ? 'm' : 'o'}g`;
    const questions = list.map((w, i) => {
      const id = `${type === 'definition_match' ? 'm' : 'o'}${i + 1}`;
      answerKey[id] = { accept: [letter(opts.indexOf(w[field]!.trim()))] };
      return { id, number: ++n, text: w.word };
    });
    groups.push({
      id: gid, type, allowReuse: false,
      instructions: type === 'definition_match' ? `Match each word with its meaning, ${letter(0)}–${letter(opts.length - 1)}.` : `Choose the OPPOSITE of each word, ${letter(0)}–${letter(opts.length - 1)}.`,
      optionsTitle: type === 'definition_match' ? 'Meanings' : 'Opposites',
      options: opts.map((text, i) => ({ label: letter(i), text })), questions
    } as QuestionGroup);
  };
  group('definition_match', withMeaning, 'meaning');
  group('opposite_match', withOpposite, 'opposite');
  const doc: TestDocumentInput = {
    title: `${set.number !== null ? `Set ${set.number}` : set.theme} quiz — ${new Date().toISOString().slice(0, 10)}`,
    skill: 'vocabulary', kind: 'practice', instructions: 'Made by Test me', vocabularySetId: set.id,
    parts: [{ id: 'v1', title: set.number !== null ? `Set ${set.number}: ${set.theme}` : set.theme, questionGroups: groups as never }],
    answerKey
  };
  const t = await createTest(db, doc, { source: 'manual' });
  return { testId: t.id, reused: false };
}
