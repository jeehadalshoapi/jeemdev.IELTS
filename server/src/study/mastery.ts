/*
 * Mastery ladders (Phase 12, ielts-site-spec-mastery.md item 1). A step repeats until its pass rule is met
 * (band 7+ or 90 %+ on 2 attempts in a row); then it is "passed" and the next step of the ladder unlocks.
 * Tests link to a step with "masteryStepId"; their attempts are added when scored (submit) or marked (save_feedback).
 */
import {
  MASTERY_STATUSES, MasteryStepInput, trailingPasses,
  type MasteryAttempt, type MasteryLadder, type MasteryResponse, type MasteryStatus, type MasteryStep
} from '@ielts/shared';
import { asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { attempts, masterySteps, tests } from '../db/schema';
import { HttpError } from '../http/errors';

type Row = typeof masterySteps.$inferSelect;

export function stepOf(r: Row): MasteryStep {
  return {
    id: r.id, ladder: r.ladder, ladderTitle: r.ladderTitle, order: r.order, title: r.title, task: r.task, lessonId: r.lessonId,
    passRule: r.passRule, status: r.status, attempts: r.attempts, passesInARow: trailingPasses(r.attempts), updatedAt: r.updatedAt.toISOString()
  };
}

/**
 * Keep a ladder consistent: when no step is being worked on (active / recheck), the first step that is not passed
 * becomes active — so a new ladder starts at its first step, and passing a step opens the next one.
 */
async function openNextStep(db: Db, ladder: string): Promise<void> {
  const rows = await db.select().from(masterySteps).where(eq(masterySteps.ladder, ladder)).orderBy(asc(masterySteps.order), asc(masterySteps.id));
  if (rows.some(r => r.status === 'active' || r.status === 'recheck')) return;
  const next = rows.find(r => r.status !== 'passed');
  if (next) await db.update(masterySteps).set({ status: 'active', updatedAt: new Date() }).where(eq(masterySteps.id, next.id));
}

export const UpsertStepsInput = z.array(MasteryStepInput).min(1, { error: 'needs at least one step' }).max(60, { error: 'at most 60 steps per call' });

/** create or update steps; attempts are kept, and the status too unless one is given */
export async function upsertSteps(db: Db, input: unknown): Promise<{ created: string[]; updated: string[]; steps: MasteryStep[] }> {
  const steps = UpsertStepsInput.parse(input);
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) throw new HttpError(400, 'duplicate_step', `Step id "${s.id}" is listed twice.`);
    ids.add(s.id);
  }
  const existing = new Map((await db.select().from(masterySteps).where(inArray(masterySteps.id, [...ids]))).map(r => [r.id, r]));
  const created: string[] = [], updated: string[] = [];
  const ladders = new Set<string>();
  const now = new Date();
  for (const s of steps) {
    const values = {
      ladder: s.ladder, ladderTitle: s.ladderTitle ?? null, order: s.order, title: s.title, task: s.task ?? null, lessonId: s.lessonId ?? null,
      passRule: s.passRule, updatedAt: now
    };
    const old = existing.get(s.id);
    if (old) {
      await db.update(masterySteps).set({ ...values, ...(s.status ? { status: s.status } : {}) }).where(eq(masterySteps.id, s.id));
      if (old.ladder !== s.ladder) ladders.add(old.ladder);
      updated.push(s.id);
    } else {
      await db.insert(masterySteps).values({ id: s.id, ...values, status: s.status ?? 'locked' });
      created.push(s.id);
    }
    ladders.add(s.ladder);
  }
  // one ladder title for the whole ladder: the last one given wins
  for (const s of steps) if (s.ladderTitle) await db.update(masterySteps).set({ ladderTitle: s.ladderTitle }).where(eq(masterySteps.ladder, s.ladder));
  for (const l of ladders) await openNextStep(db, l);
  const rows = await db.select().from(masterySteps).where(inArray(masterySteps.id, [...ids]));
  return { created, updated, steps: rows.sort((a, b) => a.ladder.localeCompare(b.ladder) || a.order - b.order).map(stepOf) };
}

export async function getStep(db: Db, id: string): Promise<MasteryStep | null> {
  const [r] = await db.select().from(masterySteps).where(eq(masterySteps.id, id)).limit(1);
  return r ? stepOf(r) : null;
}

/** tests linked to steps (content.masteryStepId), newest first */
export async function stepTests(db: Db, stepIds?: string[]): Promise<MasteryResponse['tests']> {
  const linked = sql<string>`${tests.content}->>'masteryStepId'`;
  const rows = await db.select({ id: tests.id, title: tests.title, status: tests.status, stepId: linked }).from(tests)
    .where(isNotNull(linked)).orderBy(desc(tests.createdAt));
  const out: MasteryResponse['tests'] = {};
  for (const r of rows) {
    if (stepIds && !stepIds.includes(r.stepId)) continue;
    (out[r.stepId] ??= []).push({ id: r.id, title: r.title, archived: r.status === 'archived' });
  }
  return out;
}

export async function listMastery(db: Db, ladder?: string): Promise<MasteryResponse> {
  const rows = await db.select().from(masterySteps).where(ladder ? eq(masterySteps.ladder, ladder) : undefined).orderBy(asc(masterySteps.ladder), asc(masterySteps.order), asc(masterySteps.id));
  const byLadder = new Map<string, MasteryStep[]>();
  for (const r of rows) {
    const list = byLadder.get(r.ladder) ?? [];
    list.push(stepOf(r));
    byLadder.set(r.ladder, list);
  }
  const ladders: MasteryLadder[] = [...byLadder].map(([code, steps]) => ({
    ladder: code,
    ladderTitle: steps.find(s => s.ladderTitle)?.ladderTitle ?? null,
    steps,
    current: steps.find(s => s.status === 'recheck') ?? steps.find(s => s.status === 'active') ?? null
  }));
  return { ladders, tests: await stepTests(db, rows.map(r => r.id)) };
}

/** Claude's manual change: a status (e.g. "recheck" when a passed skill slips in a full test), or a fresh start */
export async function updateStep(db: Db, id: string, change: { status?: MasteryStatus; resetAttempts?: boolean }): Promise<MasteryStep> {
  const [r] = await db.select().from(masterySteps).where(eq(masterySteps.id, id)).limit(1);
  if (!r) throw new HttpError(404, 'not_found', `There is no mastery step "${id}". Use list_mastery to see the step ids.`);
  if (change.status && !(MASTERY_STATUSES as readonly string[]).includes(change.status)) throw new HttpError(400, 'invalid', 'status must be locked, active, passed or recheck');
  await db.update(masterySteps).set({
    ...(change.status ? { status: change.status } : {}),
    ...(change.resetAttempts ? { attempts: [] } : {}),
    updatedAt: new Date()
  }).where(eq(masterySteps.id, id));
  await openNextStep(db, r.ladder);
  return (await getStep(db, id))!;
}

export async function deleteStep(db: Db, id: string): Promise<boolean> {
  const [r] = await db.delete(masterySteps).where(eq(masterySteps.id, id)).returning();
  if (r) await openNextStep(db, r.ladder);
  return !!r;
}

/**
 * Add an attempt of a step's test to the step (after scoring, or after Claude's feedback). Idempotent: the same attempt
 * replaces its earlier entry. A minBand step needs a band (the auto-scored band of reading / listening, or Claude's
 * overall band); a minPercent step uses the auto-marked score. Returns null when the attempt does not count (yet).
 */
export async function recordMasteryAttempt(db: Db, attemptId: string): Promise<{ stepId: string; entry: MasteryAttempt; status: MasteryStatus } | null> {
  const [row] = await db.select().from(attempts).innerJoin(tests, eq(attempts.testId, tests.id)).where(eq(attempts.id, attemptId)).limit(1);
  if (!row || row.attempts.status === 'in_progress') return null;
  const stepId = row.tests.content.masteryStepId;
  if (!stepId) return null;
  const [step] = await db.select().from(masterySteps).where(eq(masterySteps.id, stepId)).limit(1);
  if (!step) return null;

  const a = row.attempts;
  const auto = a.autoScore as { raw?: number; total?: number; band?: number | null } | null;
  const percent = auto?.total ? Math.round(((auto.raw ?? 0) / auto.total) * 1000) / 10 : null;
  const feedbackBand = typeof a.feedback?.overallBand === 'number' ? a.feedback.overallBand : null;
  const band = feedbackBand ?? (typeof auto?.band === 'number' ? auto.band : null);
  const rule = step.passRule;
  let passed: boolean;
  if ('minBand' in rule) {
    if (band === null) return null; // writing / speaking: wait for Claude's band
    passed = band >= rule.minBand;
  } else {
    if (percent === null) return null;
    passed = percent >= rule.minPercent;
  }
  const entry: MasteryAttempt = { attemptId, date: (a.submittedAt ?? a.updatedAt).toISOString().slice(0, 10), band, percent, passed };

  return db.transaction(async tx => {
    const [cur] = await tx.select().from(masterySteps).where(eq(masterySteps.id, stepId)).limit(1);
    if (!cur) return null;
    const i = cur.attempts.findIndex(x => x.attemptId === attemptId);
    const list = i >= 0 ? cur.attempts.map((x, j) => (j === i ? entry : x)) : [...cur.attempts, entry];
    let status = cur.status;
    if (status === 'recheck') { if (passed) status = 'passed'; }
    else if (status !== 'passed' && trailingPasses(list) >= cur.passRule.inARow) status = 'passed';
    await tx.update(masterySteps).set({ attempts: list, status, updatedAt: new Date() }).where(eq(masterySteps.id, stepId));
    if (status === 'passed' && cur.status !== 'passed') await openNextStep(tx as unknown as Db, cur.ladder);
    return { stepId, entry, status };
  });
}
