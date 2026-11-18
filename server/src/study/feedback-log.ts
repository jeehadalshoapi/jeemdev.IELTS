/* save_feedback -> mistakes log: mistakes marked "addToLog" are filed once per attempt (ielts-site-spec.md item 3). */
import { mistakeCategoryOf, pairKey, type FeedbackMistake, type MistakeInput } from '@ielts/shared';
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { mistakes } from '../db/schema';
import { addMistakes } from './store';

export interface FeedbackLogResult { added: number; repeated: number; alreadyLogged: number; skipped: Array<{ index: number; reason: string }> }

export async function logFeedbackMistakes(db: Db, attemptId: string, testTitle: string, list: FeedbackMistake[], now: Date): Promise<FeedbackLogResult | null> {
  const wanted = list.map((m, index) => ({ m, index })).filter(x => x.m.addToLog === true);
  if (!wanted.length) return null;
  const skipped: FeedbackLogResult['skipped'] = [];
  const entries: Array<{ index: number; input: MistakeInput }> = [];
  for (const { m, index } of wanted) {
    const category = mistakeCategoryOf(m.category);
    if (!m.yourAnswer?.trim() || !m.correct?.trim()) { skipped.push({ index, reason: 'needs both yourAnswer and correct' }); continue; }
    if (!category) { skipped.push({ index, reason: `category "${m.category ?? ''}" is not one of: spelling, grammar, capitals, word choice, collocation, reading trap` }); continue; }
    entries.push({
      index,
      input: {
        category, wrong: m.yourAnswer, correct: m.correct, rule: m.rule ?? m.explanation,
        source: { date: now.toISOString().slice(0, 10), attemptId, ...(testTitle ? { label: testTitle } : {}) }
      }
    });
  }
  // saving the feedback again must not count the same mistakes twice
  const keys = entries.map(e => pairKey(e.input.wrong, e.input.correct));
  const existing = keys.length ? await db.select({ pairKey: mistakes.pairKey, source: mistakes.source }).from(mistakes).where(inArray(mistakes.pairKey, keys)) : [];
  const done = new Set(existing.filter(e => e.source?.attemptId === attemptId).map(e => e.pairKey));
  const fresh = entries.filter((e, i) => !done.has(keys[i]!) && keys.indexOf(keys[i]!) === i);
  const r = await addMistakes(db, fresh.map(e => e.input));
  return { added: r.added.length, repeated: r.repeated.length, alreadyLogged: entries.length - fresh.length, skipped };
}
