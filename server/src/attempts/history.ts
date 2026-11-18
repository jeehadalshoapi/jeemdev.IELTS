import type { AttemptSummary, AutoScore, HistoryResponse, MarkReason, QuestionType, SkillHistory, TypeHistory } from '@ielts/shared';
import { desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attempts, tests } from '../db/schema';
import { summarize } from './service';

const roundHalf = (x: number) => Math.round(x * 2) / 2;

/** scores over time per skill, accuracy per question type, and the most common mistake reasons */
export async function buildHistory(db: Db): Promise<HistoryResponse> {
  const rows = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id))
    .where(ne(attempts.status, 'in_progress')).orderBy(desc(attempts.submittedAt)).limit(500);
  const list: AttemptSummary[] = rows.map(r => summarize(r.attempts, r.tests));

  // oldest first for the trend lines
  const chronological = [...rows].reverse();
  const bySkill: HistoryResponse['bySkill'] = {};
  const add = (skill: 'reading' | 'listening' | 'writing' | 'speaking', p: SkillHistory['points'][number]) => {
    const h = bySkill[skill] ??= { attempts: 0, latestBand: null, bestBand: null, averageBand: null, points: [] };
    h.attempts++;
    h.points.push(p);
  };
  const typeRuns = new Map<QuestionType, Array<{ raw: number; total: number }>>();
  const reasons: Record<MarkReason, number> = { correct: 0, blank: 0, wrong: 0, over_word_limit: 0, likely_spelling: 0 };

  for (const { attempts: a, tests: t } of chronological) {
    const s = a.autoScore as unknown as AutoScore | null;
    const date = (a.submittedAt ?? a.updatedAt).toISOString();
    const feedbackBand = typeof (a.feedback as { overallBand?: unknown } | null)?.overallBand === 'number' ? (a.feedback as { overallBand: number }).overallBand : null;
    if (t.skill === 'writing' || t.skill === 'speaking') {
      add(t.skill, { attemptId: a.id, date, band: feedbackBand, raw: 0, total: 0, title: t.title });
    }
    if (!s) continue;
    for (const [sec, v] of Object.entries(s.sections)) {
      if (v) add(sec as 'reading' | 'listening', { attemptId: a.id, date, band: v.band, raw: v.raw, total: v.total, title: t.title });
    }
    for (const [type, v] of Object.entries(s.perType)) {
      if (!v) continue;
      const runs = typeRuns.get(type as QuestionType) ?? [];
      runs.push(v);
      typeRuns.set(type as QuestionType, runs);
    }
    for (const [r, n] of Object.entries(s.reasons)) reasons[r as MarkReason] += n;
  }

  for (const h of Object.values(bySkill)) {
    const bands = h.points.map(p => p.band).filter((b): b is number => b !== null);
    h.latestBand = bands.at(-1) ?? null;
    h.bestBand = bands.length ? Math.max(...bands) : null;
    const last5 = bands.slice(-5);
    h.averageBand = last5.length ? roundHalf(last5.reduce((x, y) => x + y, 0) / last5.length) : null;
  }

  const sum = (runs: Array<{ raw: number; total: number }>) => runs.reduce((acc, r) => ({ raw: acc.raw + r.raw, total: acc.total + r.total }), { raw: 0, total: 0 });
  const pct = (t: { raw: number; total: number }) => (t.total ? (t.raw / t.total) * 100 : 0);
  const byType: TypeHistory[] = [...typeRuns.entries()].map(([type, runs]) => {
    const recent = sum(runs.slice(-3));
    const before = runs.length >= 4 ? sum(runs.slice(-6, -3)) : null;
    return { type, ...sum(runs), recent, trend: before && before.total ? Math.round(pct(recent) - pct(before)) : null };
  }).sort((a, b) => b.total - a.total);

  return { attempts: list, bySkill, byType, reasons };
}
