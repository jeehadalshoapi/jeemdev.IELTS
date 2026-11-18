/* Connector tools for the study plan and for pictures (Phase 10, ielts-site-spec.md items 7 and 8). */
import { BLOCK_STATUSES } from '@ielts/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Db } from '../db/client';
import type { FileStore } from '../files/store';
import { sanitizeSvg, SvgError } from '../files/svg';
import { getPlan, setPlan, updateBlock } from '../study/plan';
import { fail, logged, ok } from './common';

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DAY_FORMAT = '{ day: 24, date: "2026-11-18", title: "Task Response: thesis precision", skill?: "writing", notes?, blocks: [{ id: "d24b1" (unique in the whole plan), title: "Set 3 quiz", minutes?: 12, testId?: uuid, lessonId?: "day24-…", vocabularySetId?: "set-3", note?, status?: todo | done | skipped }] }';

export function registerPlanTools(server: McpServer, db: Db, origin: string, fileStore?: FileStore): void {
  const SetArgs = z.object({
    days: z.array(z.record(z.string(), z.unknown())).min(1).max(400).describe(`study days: ${DAY_FORMAT}`),
    replace: z.boolean().optional().describe('true = the plan becomes exactly these days (others are deleted); default: add / replace only these days')
  });
  server.registerTool('set_plan', {
    title: 'Set the study plan',
    description: `Save days of the student's study plan. The dashboard shows "Today: Day N, x of y blocks done", the blocks of today with links, and blocks still open from earlier days; every 5th day it asks to re-test the vocabulary sets met so far. A block with a testId is ticked automatically when that test is submitted. ${DAY_FORMAT}. Replacing a day keeps the status of blocks with the same id unless you give one.`,
    inputSchema: SetArgs,
    annotations: WRITE
  }, logged('set_plan', async (a: z.infer<typeof SetArgs>) => ok({ ...(await setPlan(db, { days: a.days }, a.replace ?? false)), url: `${origin}/#/plan` })));

  const GetArgs = z.object({ fromDay: z.number().int().optional(), toDay: z.number().int().optional() });
  server.registerTool('get_plan', {
    title: 'Get the study plan',
    description: 'The study plan, day by day, with every block and its status (todo / done / skipped).',
    inputSchema: GetArgs,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, logged('get_plan', async (a: z.infer<typeof GetArgs>) => ok({ days: await getPlan(db, a) })));

  const BlockArgs = z.object({ id: z.string().min(1).describe('the block id, e.g. "d24b1"'), status: z.enum(BLOCK_STATUSES) });
  server.registerTool('update_block', {
    title: 'Update a plan block',
    description: 'Mark one block of the plan todo, done or skipped.',
    inputSchema: BlockArgs,
    annotations: WRITE
  }, logged('update_block', async (a: z.infer<typeof BlockArgs>) => ok({ saved: true, ...(await updateBlock(db, a.id, a.status)) })));

  const AssetArgs = z.object({
    svg: z.string().min(20).max(400_000).describe('one complete SVG document as text: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"> … </svg>. Shapes, paths, text, gradients and markers only (no scripts, links, external images or fonts).'),
    name: z.string().max(80).optional().describe('a short name, e.g. "campus-map"')
  });
  server.registerTool('upload_asset', {
    title: 'Upload a picture (SVG)',
    description: 'Save an SVG drawing (a map, a plan, a diagram, a Task 1 picture) on the site and get its url, to use as "imageUrl" in a test (map_labelling, diagram_labelling, writing_task1, any question group). The SVG is cleaned: anything that is not plain drawing is removed and listed in "removed". Use letters (A, B, C…) as text labels where the student must answer.',
    inputSchema: AssetArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, logged('upload_asset', async (a: z.infer<typeof AssetArgs>) => {
    if (!fileStore) return fail('Uploads are not available on this server.');
    let clean: ReturnType<typeof sanitizeSvg>;
    try { clean = sanitizeSvg(a.svg); } catch (e) { if (e instanceof SvgError) return fail(`The SVG was not saved: ${e.message}`); throw e; }
    const base = (a.name ?? 'drawing').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'drawing';
    const saved = await fileStore.save({ data: new TextEncoder().encode(clean.svg), originalName: `${base}.svg`, mimeType: 'image/svg+xml', kind: 'image' });
    return ok({ saved: true, url: saved.url, fullUrl: `${origin}${saved.url}`, bytes: clean.svg.length, ...(clean.removed.length ? { removed: clean.removed } : {}), use: `"imageUrl": "${saved.url}"` });
  }));
}
