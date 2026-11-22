/* Connector tools for mastery ladders (Phase 12, ielts-site-spec-mastery.md item 1). */
import { MASTERY_STATUSES, describePassRule, type MasteryStep } from '@ielts/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Db } from '../db/client';
import { deleteStep, getStep, listMastery, stepTests, updateStep, upsertSteps } from '../study/mastery';
import { fail, logged, ok } from './common';

const STEP_FORMAT = '{ id: "w1-introduction", ladder: "W", ladderTitle?: "Writing, one part at a time", order: 1, title: "W1 Introduction", task?: "5-min plan + 2-sentence introduction", lessonId?: "day24-task-response", passRule: { minBand: 7, inARow: 2 } (writing / speaking: Claude\'s overall band, or the estimated band of reading / listening) or { minPercent: 90, inARow: 2 } (auto-marked tests), status?: locked | active | passed | recheck }';

const brief = (s: MasteryStep) => ({
  id: s.id, ladder: s.ladder, order: s.order, title: s.title, status: s.status, passRule: s.passRule, passRuleText: describePassRule(s.passRule),
  passesInARow: s.passesInARow, attempts: s.attempts.length, ...(s.task ? { task: s.task } : {}), ...(s.lessonId ? { lessonId: s.lessonId } : {})
});

export function registerMasteryTools(server: McpServer, db: Db, origin: string): void {
  const url = `${origin}/#/mastery`;
  const withUrl = (t: { id: string; title: string; archived: boolean }) => ({ id: t.id, title: t.title, url: `${origin}/#/test/${t.id}`, ...(t.archived ? { archived: true } : {}) });

  const UpsertArgs = z.object({
    steps: z.array(z.record(z.string(), z.unknown())).min(1).max(60).describe(`one or more steps: ${STEP_FORMAT}`)
  });
  server.registerTool('upsert_mastery_step', {
    title: 'Create or update mastery steps',
    description: `Create or replace one or more steps of a mastery ladder (W writing, S, V vocabulary, R reading, L, P …). A step repeats until its passRule is met, then it is "passed" and the next step (by order) unlocks. A new step starts locked; the first open step of each ladder (lowest order) becomes active by itself. Replacing a step keeps its attempts, and its status unless you give one. Attempts already submitted on tests that carry a new step's masteryStepId are counted at once ("backfilled"). Link tests to a step with "masteryStepId" (create_test / update_test). ${STEP_FORMAT}`,
    inputSchema: UpsertArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, logged('upsert_mastery_step', async (a: z.infer<typeof UpsertArgs>) => {
    const r = await upsertSteps(db, a.steps);
    return ok({ saved: true, created: r.created, updated: r.updated, backfilledAttempts: r.backfilled, steps: r.steps.map(brief), url });
  }));

  const ListArgs = z.object({ ladder: z.string().min(1).max(20).optional().describe('only this ladder, e.g. "W"') });
  server.registerTool('list_mastery', {
    title: 'List mastery ladders',
    description: 'Every ladder with its steps in order: id, title, task, status (locked / active / passed / recheck), the pass rule, passes in a row so far, every attempt that counted (attemptId, date, band or percent, passed), and the newest linked test (id, title, url). The current step of a ladder is its active (or recheck) step.',
    inputSchema: ListArgs,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, logged('list_mastery', async (a: z.infer<typeof ListArgs>) => {
    const m = await listMastery(db, a.ladder);
    return ok({
      ladders: m.ladders.map(l => ({
        ladder: l.ladder, ladderTitle: l.ladderTitle, current: l.current?.id ?? null,
        steps: l.steps.map(s => {
          const tests = m.tests[s.id] ?? [];
          const newest = tests.find(t => !t.archived) ?? tests[0];
          return { ...brief(s), attempts: s.attempts, newestTest: newest ? withUrl(newest) : null, linkedTests: tests.length };
        })
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
    return ok({ ...s, passRuleText: describePassRule(s.passRule), tests: ((await stepTests(db, [s.id]))[s.id] ?? []).map(withUrl), url });
  }));

  const UpdateArgs = z.object({
    id: z.string().min(1).max(80).describe('the step id'),
    changes: z.object({
      status: z.enum(MASTERY_STATUSES).optional().describe('"recheck" when a passed skill slips in a full test: the step comes back for one more pass. "passed" also unlocks the next step.'),
      title: z.string().optional(),
      task: z.string().nullable().optional(),
      lessonId: z.string().nullable().optional(),
      order: z.number().int().optional(),
      passRule: z.record(z.string(), z.unknown()).optional().describe('{ "minBand": 7, "inARow": 2 } or { "minPercent": 90, "inARow": 2 }'),
      resetAttempts: z.boolean().optional().describe('true = clear the attempts that counted so far (a fresh start)')
    }).optional().describe('the fields to change'),
    status: z.enum(MASTERY_STATUSES).optional().describe('short form of changes.status'),
    resetAttempts: z.boolean().optional().describe('short form of changes.resetAttempts'),
    delete: z.boolean().optional().describe('true = delete the step')
  });
  server.registerTool('update_mastery_step', {
    title: 'Update a mastery step',
    description: 'Change one step: { id, changes: { status?, task?, lessonId?, passRule?, title?, order?, resetAttempts? } }, or delete it with "delete": true. Status "recheck" after a mock when a passed skill slipped: one attempt that meets the rule passes it again.',
    inputSchema: UpdateArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, logged('update_mastery_step', async (a: z.infer<typeof UpdateArgs>) => {
    if (a.delete) return (await deleteStep(db, a.id)) ? ok({ deleted: a.id }) : fail(`There is no mastery step "${a.id}".`);
    const changes = { ...(a.status ? { status: a.status } : {}), ...(a.resetAttempts ? { resetAttempts: true } : {}), ...(a.changes ?? {}) };
    if (!Object.keys(changes).length) return fail('Give "changes" (status, task, lessonId, passRule …) or "delete": true.');
    const s = await updateStep(db, a.id, changes as Parameters<typeof updateStep>[2]);
    return ok({ saved: true, step: brief(s), url });
  }));
}
