/* Mastery ladders (ielts-site-spec-mastery.md item 1): steps that repeat until passed, then unlock the next step. */
import { z } from 'zod';
import { Slug } from './study';

export const MASTERY_STATUSES = ['locked', 'active', 'passed', 'recheck'] as const;
export type MasteryStatus = (typeof MASTERY_STATUSES)[number];

const InARow = z.number({ error: 'must be a whole number, e.g. 2' }).int().min(1).max(10);
/** band 7+ twice in a row (writing, speaking), or 90 %+ twice in a row (auto-marked tests) */
export const PassRule = z.union([
  z.strictObject({ minBand: z.number({ error: 'must be a band, e.g. 7' }).min(1).max(9).multipleOf(0.5, { error: 'must be a whole or half band' }), inARow: InARow.default(2) }),
  z.strictObject({ minPercent: z.number({ error: 'must be a percentage, e.g. 90' }).min(1).max(100), inARow: InARow.default(2) })
], { error: 'must be { "minBand": 7, "inARow": 2 } or { "minPercent": 90, "inARow": 2 }' });
export type PassRule = z.output<typeof PassRule>;

export const MasteryStepInput = z.strictObject({
  id: Slug,
  /** a short ladder code: "W", "S", "V", "R", "L", "P" */
  ladder: z.string({ error: 'must be a ladder code such as "W"' }).trim().min(1).max(20),
  ladderTitle: z.string().trim().max(120).optional(),
  /** position in the ladder (1 = first step) */
  order: z.number({ error: 'must be the step number in the ladder, e.g. 1' }).int().min(0).max(999),
  title: z.string().trim().min(1, { error: 'must not be empty' }).max(200),
  task: z.string().trim().max(2000).optional(),
  lessonId: Slug.optional(),
  passRule: PassRule,
  /** leave out to keep the current status (a new step starts locked; the first open step of a ladder becomes active) */
  status: z.enum(MASTERY_STATUSES, { error: 'must be locked, active, passed or recheck' }).optional()
});
export type MasteryStepInput = z.input<typeof MasteryStepInput>;

/** one scored or marked attempt of a step's test */
export interface MasteryAttempt {
  attemptId: string;
  /** submission date, YYYY-MM-DD */
  date: string;
  band: number | null;
  percent: number | null;
  passed: boolean;
}

export interface MasteryStep {
  id: string;
  ladder: string;
  ladderTitle: string | null;
  order: number;
  title: string;
  task: string | null;
  lessonId: string | null;
  passRule: PassRule;
  status: MasteryStatus;
  attempts: MasteryAttempt[];
  /** passes in a row at the end of the attempts list (what the dots show) */
  passesInARow: number;
  updatedAt: string;
}

export interface MasteryLadder {
  ladder: string;
  ladderTitle: string | null;
  steps: MasteryStep[];
  /** the step to work on now: active or recheck (else null when every step is passed or none is open) */
  current: MasteryStep | null;
}

/** GET /api/mastery */
export interface MasteryResponse {
  ladders: MasteryLadder[];
  /** tests linked to each step (masteryStepId), newest first */
  tests: Record<string, Array<{ id: string; title: string; archived: boolean }>>;
}

/** passes in a row at the end of a list of attempts */
export function trailingPasses(attempts: readonly MasteryAttempt[]): number {
  let n = 0;
  for (let i = attempts.length - 1; i >= 0 && attempts[i]!.passed; i--) n++;
  return n;
}

export function describePassRule(r: PassRule): string {
  const times = r.inARow === 1 ? 'once' : r.inARow === 2 ? 'twice in a row' : `${r.inARow} times in a row`;
  return 'minBand' in r ? `band ${r.minBand}+ ${times}` : `${r.minPercent}%+ ${times}`;
}
