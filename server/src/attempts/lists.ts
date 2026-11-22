/*
 * Dashboard and Done page lists (Phase 12). The dashboard keeps only what is still to do; a test moves to the Done page
 * once an attempt of it is submitted — except the newest test of a mastery step that is not passed yet (it repeats until passed).
 */
import { totalMarks, trailingPasses, type AttemptSummary, type DashboardResponse, type DoneResponse, type TestListItem } from '@ielts/shared';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { masterySteps, tests, type TestRow } from '../db/schema';
import { listAttemptSummaries } from './service';

const WEEK_MS = 7 * 24 * 3600 * 1000;

async function buildLists(db: Db) {
  const [testRows, summaries, steps] = await Promise.all([
    db.select().from(tests).where(eq(tests.status, 'assigned')).orderBy(desc(tests.createdAt)),
    listAttemptSummaries(db, { limit: 2000 }),
    db.select().from(masterySteps)
  ]);
  const stepById = new Map(steps.map(s => [s.id, s]));
  // the newest test of each step: the one to practise with (older tests of the step go to the Done page once submitted)
  const newestOfStep = new Map<string, string>();
  for (const t of testRows) if (t.content.masteryStepId && !newestOfStep.has(t.content.masteryStepId)) newestOfStep.set(t.content.masteryStepId, t.id);
  const completed = summaries.filter(s => s.status !== 'in_progress').sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));

  const item = (t: TestRow): TestListItem & { finished: boolean } => {
    const mine = summaries.filter(s => s.testId === t.id);
    const step = t.content.masteryStepId ? stepById.get(t.content.masteryStepId) : undefined;
    const last = completed.find(s => s.testId === t.id) ?? null;
    return {
      id: t.id, title: t.title, skill: t.skill, kind: t.kind, dueDate: t.dueDate,
      timeLimitMin: t.content.timeLimitMin ?? null, marks: totalMarks(t.content.parts), parts: t.content.parts.length,
      createdAt: t.createdAt.toISOString(),
      attemptCount: mine.length,
      inProgressAttemptId: mine.find(s => s.status === 'in_progress')?.id ?? null,
      lastAttempt: last,
      mastery: step ? { stepId: step.id, title: step.title, status: step.status, passesInARow: trailingPasses(step.attempts), inARow: step.passRule.inARow } : null,
      // finished = submitted at least once — except the newest test of a mastery step still to pass (it repeats)
      finished: !!last && (!step || step.status === 'passed' || newestOfStep.get(step.id) !== t.id)
    };
  };
  const items = testRows.map(item);
  const strip = ({ finished: _f, ...rest }: TestListItem & { finished: boolean }): TestListItem => rest;
  return { items, strip, summaries, completed };
}

export async function dashboardLists(db: Db, now = new Date()): Promise<DashboardResponse> {
  const { items, strip, summaries, completed } = await buildLists(db);
  return {
    assigned: items.filter(t => !t.finished || t.inProgressAttemptId).map(strip),
    inProgress: summaries.filter(s => s.status === 'in_progress'),
    doneCount: items.filter(t => t.finished).length,
    feedbackReady: completed.filter(a => a.feedbackReady).length,
    newFeedback: completed.filter((a: AttemptSummary) => a.feedbackReady && a.status === 'marked' && now.getTime() - Date.parse(a.submittedAt ?? '') < WEEK_MS).slice(0, 5)
  };
}

export async function doneLists(db: Db): Promise<DoneResponse> {
  const { items, strip, completed } = await buildLists(db);
  return {
    tests: items.filter(t => t.finished).sort((a, b) => (b.lastAttempt?.submittedAt ?? '').localeCompare(a.lastAttempt?.submittedAt ?? '')).map(strip),
    completed
  };
}
