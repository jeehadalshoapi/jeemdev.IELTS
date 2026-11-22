/* Connector tools for mastery ladders (Phase 12, ielts-site-spec-mastery.md item 1). */
import { MASTERY_STATUSES, describePassRule, type MasteryStep } from '@ielts/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Db } from '../db/client';
import { deleteStep, getStep, listMastery, stepTests, updateStep, upsertSteps } from '../study/mastery';
import { fail, logged, ok } from './common';

const STEP_FORMAT = '{ id: "w1-introduction", ladder: "W", ladderTitle?: "Writing, one part at a time", order: 1, title: "W1 Introduction", task?: "5-min plan + 2-sentence introduction", lessonId?: "day24-task-response", passRule: { minBand: 7, inARow: 2 } (writing / speaking: Claude\'s overall band, or the estimated band of reading / listening) or { minPercent: 90, inARow: 2 } (auto-marked tests), status?: locked | active | passed | recheck }';

const brief = (s: MasteryStep) => ({
  id: s.id, ladder: s.ladder, order: s.order, title: s.title, status: s.status, passRule: describePassRule(s.passRule),
  passesInARow: s.passesInARow, attempts: s.attempts.length, ...(s.task ? { task: s.task } : {}), ...(s.lessonId ? { lessonId: s.lessonId } : {})
});

export function registerMasteryTools(server: McpServer, db: Db, origin: string): void {
  const url = `${origin}/#/mastery`;

  const UpsertArgs = z.object({
    steps: z.array(z.record(z.string(), z.unknown())).min(1).max(60).describe(`one or more steps: ${STEP_FORMAT}`)
  });
  server.registerTool('upsert_mastery_step', {
    title: 'Create or update mastery steps',
    description: `Save steps of a mastery ladder (W writing, S, V vocabulary, R reading, L, P …). A step repeats until its passRule is met, then it is "passed" and the next step (by order) unlocks. A new step starts locked; the first open step of each ladder becomes active by itself. Updating keeps the step's attempts, and its status unless you give one. Link tests to a step with "masteryStepId" (create_test / update_test). ${STEP_FORMAT}`,
    inputSchema: UpsertArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, logged('upsert_mastery_step', async (a: z.infer<typeof UpsertArgs>) => {
    const r = await upsertSteps(db, a.steps);
    return ok({ saved: true, created: r.created, updated: r.updated, steps: r.steps.map(brief), url });
  }));

  const ListArgs = z.object({ ladder: z.string().min(1).max(20).optional().describe('only this ladder, e.g. "W"') });
  server.registerTool('list_mastery', {
    title: 'List mastery ladders',
    description: 'Every ladder with its steps in order: status (locked / active / passed / recheck), the pass rule, passes in a row, how many attempts, and the tests linked to each step. The current step of a ladder is its active (or recheck) step.',
    inputSchema: ListArgs,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, logged('list_mastery', async (a: z.infer<typeof ListArgs>) => {
    const m = await listMastery(db, a.ladder);
    return ok({
      ladders: m.ladders.map(l => ({
        ladder: l.ladder, ladderTitle: l.ladderTitle, current: l.current?.id ?? null,
        steps: l.steps.map(s => ({ ...brief(s), tests: (m.tests[s.id] ?? []).map(t => ({ id: t.id, title: t.title, ...(t.archived ? { archived: true } : {}) })) }))
      })),
      url
    });
  }));

  const IdArgs = z.object({ id: z.string().min(1).max(80).describe('the step id, e.g. "w1-introduction"') });
  server.registerTool('get_mastery_step', {
    title: 'Get a mastery step',
    description: 'One step with every attempt that counted (date, band or percent, passed or not), its linked tests and its pass rule.',
    inputSchema: IdArgs,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, logged('get_mastery_step', async (a: z.infer<typeof IdArgs>) => {
    const s = await getStep(db, a.id);
    if (!s) return fail(`There is no mastery step "${a.id}". Use list_mastery to see the step ids.`);
    return ok({ ...s, passRuleText: describePassRule(s.passRule), tests: (await stepTests(db, [s.id]))[s.id] ?? [], url });
  }));

  const UpdateArgs = z.object({
    id: z.string().min(1).max(80).describe('the step id'),
    status: z.enum(MASTERY_STATUSES).optional().describe('"recheck" when a passed skill slips in a full test: the step comes back for one more pass. "passed" also unlocks the next step.'),
    resetAttempts: z.boolean().optional().describe('true = clear the attempts that counted so far (a fresh start)'),
    delete: z.boolean().optional().describe('true = delete the step')
  });
  server.registerTool('update_mastery_step', {
    title: 'Update a mastery step',
    description: 'Change the status of one step (locked, active, passed, recheck), clear its attempts, or delete it. A recheck step is passed again by one attempt that meets the rule.',
    inputSchema: UpdateArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, logged('update_mastery_step', async (a: z.infer<typeof UpdateArgs>) => {
    if (a.delete) return (await deleteStep(db, a.id)) ? ok({ deleted: a.id }) : fail(`There is no mastery step "${a.id}".`);
    if (!a.status && !a.resetAttempts) return fail('Give a "status", "resetAttempts": true or "delete": true.');
    const s = await updateStep(db, a.id, { ...(a.status ? { status: a.status } : {}), ...(a.resetAttempts ? { resetAttempts: true } : {}) });
    return ok({ saved: true, step: brief(s), url });
  }));
}
