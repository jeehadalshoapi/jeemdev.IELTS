import type { AttemptSummary, AutoScore, HistoryResponse, MarkReason, QuestionType, SectionSkill, SkillHistory, TypeHistory } from '@ielts/shared';
import { desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attempts, tests } from '../db/schema';
import { summarize } from './service';

const roundHalf = (x: number) => Math.round(x * 2) / 2;
type Tally = { raw: number; total: number };
type TypeRun = Tally & { attemptId: string; date: string; title: string };

/** "Word choice " / "word-choice" / "WORD_CHOICE" -> "word choice" */
export const mistakeCategory = (c: unknown) => (typeof c === 'string' ? c.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ') : '') || 'other';

/**
 * Scores over time per skill, accuracy per question type (with one point per attempt), the most common
 * mistake reasons, and the categories of the mistakes in Claude's feedback.
 * `skill` keeps attempts of tests with that skill (or a full mock with such a section) and, in a full mock,
 * only that section's questions; `since` keeps later submissions.
 */
export async function buildHistory(db: Db, opts: { skill?: SectionSkill; since?: Date } = {}): Promise<HistoryResponse> {
  const all = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id))
    .where(ne(attempts.status, 'in_progress')).orderBy(desc(attempts.submittedAt)).limit(500);
  const rows = all.filter(r =>
    (!opts.since || (r.attempts.submittedAt ?? r.attempts.updatedAt) >= opts.since) &&
    (!opts.skill || r.tests.skill === opts.skill || (r.tests.skill === 'mixed' && r.tests.content.parts.some(p => p.skill === opts.skill))));
  const list: AttemptSummary[] = rows.map(r => summarize(r.attempts, r.tests));

  // oldest first for the trend lines
  const chronological = [...rows].reverse();
  const bySkill: HistoryResponse['bySkill'] = {};
  const add = (skill: SectionSkill, p: SkillHistory['points'][number]) => {
    if (opts.skill && skill !== opts.skill) return;
    const h = bySkill[skill] ??= { attempts: 0, latestBand: null, bestBand: null, averageBand: null, points: [] };
    h.attempts++;
    h.points.push(p);
  };
  const typeRuns = new Map<QuestionType, TypeRun[]>();
  const reasons: Record<MarkReason, number> = { correct: 0, blank: 0, wrong: 0, over_word_limit: 0, likely_spelling: 0 };
  const categories = new Map<string, { count: number; attempts: Set<string> }>();

  for (const { attempts: a, tests: t } of chronological) {
    const s = a.autoScore as unknown as AutoScore | null;
    const date = (a.submittedAt ?? a.updatedAt).toISOString();
    const feedbackBand = typeof a.feedback?.overallBand === 'number' ? a.feedback.overallBand : null;
    if (t.skill === 'writing' || t.skill === 'speaking') {
      add(t.skill, { attemptId: a.id, date, band: feedbackBand, raw: 0, total: 0, title: t.title });
    }
    for (const m of Array.isArray(a.feedback?.mistakes) ? a.feedback.mistakes : []) {
      const c = categories.get(mistakeCategory(m?.category)) ?? { count: 0, attempts: new Set<string>() };
      c.count++;
      c.attempts.add(a.id);
      categories.set(mistakeCategory(m?.category), c);
    }
    if (!s) continue;
    for (const [sec, v] of Object.entries(s.sections)) {
      if (v) add(sec as SectionSkill, { attemptId: a.id, date, band: v.band, raw: v.raw, total: v.total, title: t.title });
    }
    // in a full mock filtered to one skill, only that section's questions count
    const partSkill = new Map(t.content.parts.map(p => [p.id, p.skill ?? t.skill]));
    const qs = opts.skill && t.skill === 'mixed' ? s.questions.filter(q => partSkill.get(q.partId) === opts.skill) : null;
    const perType: Partial<Record<QuestionType, Tally>> = qs ? {} : s.perType;
    if (qs) for (const q of qs) { const v = perType[q.type] ??= { raw: 0, total: 0 }; v.total++; if (q.correct) v.raw++; }
    for (const [type, v] of Object.entries(perType)) {
      if (!v) continue;
      const runs = typeRuns.get(type as QuestionType) ?? [];
      runs.push({ attemptId: a.id, date, title: t.title, raw: v.raw, total: v.total });
      typeRuns.set(type as QuestionType, runs);
    }
    if (qs) for (const q of qs) reasons[q.reason]++;
    else for (const [r, n] of Object.entries(s.reasons)) reasons[r as MarkReason] += n;
  }

  for (const h of Object.values(bySkill)) {
    const bands = h.points.map(p => p.band).filter((b): b is number => b !== null);
    h.latestBand = bands.at(-1) ?? null;
    h.bestBand = bands.length ? Math.max(...bands) : null;
    const last5 = bands.slice(-5);
    h.averageBand = last5.length ? roundHalf(last5.reduce((x, y) => x + y, 0) / last5.length) : null;
  }

  const sum = (runs: Tally[]) => runs.reduce((acc, r) => ({ raw: acc.raw + r.raw, total: acc.total + r.total }), { raw: 0, total: 0 });
  const pct = (t: Tally) => (t.total ? (t.raw / t.total) * 100 : 0);
  const byType: TypeHistory[] = [...typeRuns.entries()].map(([type, runs]) => {
    const recent = sum(runs.slice(-3));
    const before = runs.length >= 4 ? sum(runs.slice(-6, -3)) : null;
    return { type, ...sum(runs), recent, trend: before && before.total ? Math.round(pct(recent) - pct(before)) : null, points: runs };
  }).sort((a, b) => b.total - a.total);

  const feedbackMistakes = [...categories.entries()]
    .map(([category, c]) => ({ category, count: c.count, attempts: c.attempts.size }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return { attempts: list, bySkill, byType, reasons, feedbackMistakes };
}
