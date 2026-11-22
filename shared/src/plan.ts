/* Study plan and the "Today" view (Phase 10, ielts-site-spec.md item 8). */
import { z } from 'zod';
import { Slug } from './study';

const IsoDate = z.string({ error: 'must be a date like 2026-11-18' }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'must be a date like 2026-11-18' });
export const BLOCK_STATUSES = ['todo', 'done', 'skipped'] as const;
export type BlockStatus = (typeof BLOCK_STATUSES)[number];
/** the three parts of a study day (ielts-site-spec-mastery.md item 2) */
export const PLAN_SECTIONS = ['review', 'main', 'mastery'] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];
export const PLAN_SECTION_TITLES: Record<PlanSection, string> = { review: '1 · Daily review', main: '2 · Main lesson + homework', mastery: '3 · Mastery practice' };

export const PlanBlock = z.strictObject({
  /** unique in the whole plan, e.g. "d24b1" */
  id: Slug,
  title: z.string().trim().min(1, { error: 'must not be empty' }),
  minutes: z.number().int().min(1).max(600).optional(),
  /** a test or homework on the site (its block is ticked when an attempt is submitted) */
  testId: z.uuid({ error: 'must be a test id (uuid) from list_tests' }).optional(),
  lessonId: Slug.optional(),
  vocabularySetId: Slug.optional(),
  /** anything else: what to do */
  note: z.string().optional(),
  /** which part of the day: review | main | mastery (the dashboard groups today's blocks under these headings) */
  section: z.enum(PLAN_SECTIONS, { error: 'must be review, main or mastery' }).optional(),
  status: z.enum(BLOCK_STATUSES, { error: 'must be todo, done or skipped' }).default('todo')
});

export const PlanDay = z.strictObject({
  day: z.number({ error: 'must be the day number, e.g. 24' }).int().min(0).max(999),
  date: IsoDate,
  title: z.string().trim().min(1, { error: 'must not be empty' }),
  /** e.g. "writing" (the week's skill) */
  skill: z.string().optional(),
  notes: z.string().optional(),
  blocks: z.array(PlanBlock).default([])
});
export type PlanDay = z.output<typeof PlanDay>;
export type PlanBlock = z.output<typeof PlanBlock>;
export type PlanDayInput = z.input<typeof PlanDay>;

export const PlanInput = z.strictObject({
  days: z.array(PlanDay).min(1, { error: 'needs at least one day' }).max(400)
}).superRefine((p, ctx) => {
  const days = new Map<number, number>(), dates = new Map<string, number>(), blocks = new Map<string, string>();
  p.days.forEach((d, i) => {
    if (days.has(d.day)) ctx.addIssue({ code: 'custom', path: ['days', i, 'day'], message: `day ${d.day} is already days[${days.get(d.day)}]` });
    else days.set(d.day, i);
    if (dates.has(d.date)) ctx.addIssue({ code: 'custom', path: ['days', i, 'date'], message: `${d.date} is already days[${dates.get(d.date)}]` });
    else dates.set(d.date, i);
    d.blocks.forEach((b, j) => {
      const where = `days[${i}].blocks[${j}]`;
      if (blocks.has(b.id)) ctx.addIssue({ code: 'custom', path: ['days', i, 'blocks', j, 'id'], message: `block id "${b.id}" is already used at ${blocks.get(b.id)}` });
      else blocks.set(b.id, where);
    });
  });
});

/** a block with its day, for the "pending from earlier days" list */
export interface PendingBlock { day: number; date: string; block: PlanBlock }

export interface TodayResponse {
  /** the plan day whose date is today (the browser's date), or null */
  today: (PlanDay & { done: number; total: number }) | null;
  /** blocks still "todo" on earlier days */
  pending: PendingBlock[];
  /** the next planned day after today, when today has no plan */
  next: PlanDay | null;
  /** every 5th study day: re-test the vocabulary sets met so far */
  review: { day: number; sets: Array<{ id: string; number: number | null; theme: string }> } | null;
  /** titles of the tests and lessons the blocks link to */
  links: { tests: Record<string, string>; lessons: Record<string, string> };
}

export const BlockPatch = z.strictObject({ status: z.enum(BLOCK_STATUSES, { error: 'must be todo, done or skipped' }) });
export const TodayQuery = z.strictObject({ date: IsoDate });
