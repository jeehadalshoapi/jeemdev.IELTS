/* Study plan (Phase 10, ielts-site-spec.md item 8): days with blocks, the Today view, ticking blocks. */
import { BLOCK_STATUSES, PlanInput, type BlockStatus, type PendingBlock, type PlanBlock, type PlanDay, type TodayResponse } from '@ielts/shared';
import { asc, eq, gt, inArray, lt, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { lessons, planDays, tests, vocabSets } from '../db/schema';
import { HttpError } from '../http/errors';

/** every 5th study day: re-test the vocabulary sets met so far (the rule from the Vocabulary Bank) */
export const REVIEW_EVERY = 5;

const dayOf = (r: typeof planDays.$inferSelect): PlanDay => ({
  day: r.day, date: r.date, title: r.title, blocks: r.blocks,
  ...(r.skill ? { skill: r.skill } : {}), ...(r.notes ? { notes: r.notes } : {})
});

/**
 * Saves the given days (a day with the same number is replaced; its blocks keep their status unless given).
 * With `replace`, days not in the list are deleted. Block ids must be unique in the whole plan.
 */
export async function setPlan(db: Db, input: unknown, replace = false): Promise<{ saved: number; deleted: number }> {
  const p = PlanInput.parse(input);
  const rows = await db.select().from(planDays);
  const given = new Set(p.days.map(d => d.day));
  // block ids of the days that stay must not clash with the new ones
  const used = new Map<string, number>();
  for (const r of rows) if (!given.has(r.day) && !replace) for (const b of r.blocks) used.set(b.id, r.day);
  for (const d of p.days) for (const b of d.blocks) if (used.has(b.id)) throw new HttpError(400, 'duplicate_block', `Block id "${b.id}" (day ${d.day}) is already used on day ${used.get(b.id)}. Block ids must be unique in the whole plan.`);
  const datesTaken = new Map(rows.filter(r => !given.has(r.day)).map(r => [r.date, r.day]));
  for (const d of p.days) if (!replace && datesTaken.has(d.date)) throw new HttpError(400, 'duplicate_date', `${d.date} is already day ${datesTaken.get(d.date)} of the plan.`);

  const oldStatus = new Map(rows.flatMap(r => r.blocks.map(b => [b.id, b.status] as const)));
  let deleted = 0;
  await db.transaction(async tx => {
    if (replace) deleted = (await tx.delete(planDays).where(notInArray(planDays.day, [...given])).returning()).length;
    for (const d of p.days) {
      const raw = (input as { days: Array<{ blocks?: Array<{ status?: unknown }> }> }).days.find(x => (x as { day?: number }).day === d.day);
      const blocks: PlanBlock[] = d.blocks.map((b, i) => ({ ...b, status: raw?.blocks?.[i]?.status !== undefined ? b.status : oldStatus.get(b.id) ?? b.status }));
      const values = { day: d.day, date: d.date, title: d.title, skill: d.skill ?? null, notes: d.notes ?? null, blocks, updatedAt: new Date() };
      await tx.delete(planDays).where(eq(planDays.day, d.day));
      await tx.insert(planDays).values(values);
    }
  });
  return { saved: p.days.length, deleted };
}

export async function getPlan(db: Db, f: { fromDay?: number; toDay?: number } = {}): Promise<PlanDay[]> {
  const rows = await db.select().from(planDays).orderBy(asc(planDays.day));
  return rows.filter(r => (f.fromDay === undefined || r.day >= f.fromDay) && (f.toDay === undefined || r.day <= f.toDay)).map(dayOf);
}

export async function updateBlock(db: Db, id: string, status: BlockStatus): Promise<{ day: number; block: PlanBlock }> {
  if (!(BLOCK_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'invalid', 'status must be todo, done or skipped');
  const rows = await db.select().from(planDays);
  const row = rows.find(r => r.blocks.some(b => b.id === id));
  if (!row) throw new HttpError(404, 'not_found', `There is no plan block "${id}". Use get_plan to see the block ids.`);
  const blocks = row.blocks.map(b => (b.id === id ? { ...b, status } : b));
  await db.update(planDays).set({ blocks, updatedAt: new Date() }).where(eq(planDays.day, row.day));
  return { day: row.day, block: blocks.find(b => b.id === id)! };
}

/** after an attempt is submitted: blocks for that test are done */
export async function tickTestBlocks(db: Db, testId: string): Promise<number> {
  const rows = await db.select().from(planDays);
  let n = 0;
  for (const r of rows) {
    if (!r.blocks.some(b => b.testId === testId && b.status === 'todo')) continue;
    const blocks = r.blocks.map(b => (b.testId === testId && b.status === 'todo' ? (n++, { ...b, status: 'done' as const }) : b));
    await db.update(planDays).set({ blocks, updatedAt: new Date() }).where(eq(planDays.day, r.day));
  }
  return n;
}

/** the dashboard's Today card: today's day (by the browser's date), what is still open from earlier days, the review rule */
export async function today(db: Db, date: string): Promise<TodayResponse> {
  const [row] = await db.select().from(planDays).where(eq(planDays.date, date)).limit(1);
  const earlier = await db.select().from(planDays).where(lt(planDays.date, date)).orderBy(asc(planDays.day));
  const pending: PendingBlock[] = earlier.flatMap(r => r.blocks.filter(b => b.status === 'todo').map(block => ({ day: r.day, date: r.date, block })));
  const [next] = row ? [] : await db.select().from(planDays).where(gt(planDays.date, date)).orderBy(asc(planDays.date)).limit(1);
  const day = row ? dayOf(row) : null;
  let review: TodayResponse['review'] = null;
  if (day && day.day > 0 && day.day % REVIEW_EVERY === 0) {
    const sets = (await db.select({ id: vocabSets.id, number: vocabSets.number, theme: vocabSets.theme, studyDay: vocabSets.studyDay }).from(vocabSets).orderBy(asc(vocabSets.number)))
      .filter(s => s.studyDay === null || s.studyDay <= day.day);
    if (sets.length) review = { day: day.day, sets: sets.map(({ id, number, theme }) => ({ id, number, theme })) };
  }
  const blocks = [...(day?.blocks ?? []), ...pending.map(p => p.block), ...(next?.blocks ?? [])];
  const testIds = [...new Set(blocks.map(b => b.testId).filter((x): x is string => !!x))];
  const lessonIds = [...new Set(blocks.map(b => b.lessonId).filter((x): x is string => !!x))];
  const testRows = testIds.length ? await db.select({ id: tests.id, title: tests.title }).from(tests).where(inArray(tests.id, testIds)) : [];
  const lessonRows = lessonIds.length ? await db.select({ id: lessons.id, title: lessons.title }).from(lessons).where(inArray(lessons.id, lessonIds)) : [];
  return {
    today: day ? { ...day, done: day.blocks.filter(b => b.status !== 'todo').length, total: day.blocks.length } : null,
    pending,
    next: next ? dayOf(next) : null,
    review,
    links: { tests: Object.fromEntries(testRows.map(t => [t.id, t.title])), lessons: Object.fromEntries(lessonRows.map(l => [l.id, l.title])) }
  };
}
