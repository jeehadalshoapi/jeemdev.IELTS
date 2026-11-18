/* The connector's tools (spec §6). One McpServer is built per request (stateless Streamable HTTP). */
import {
  Feedback, KINDS, QUESTION_TYPE_EXAMPLES, QUESTION_TYPES, SECTION_SKILLS, SKILLS, STATUSES, TestDocument as TestDocumentSchema,
  URBAN_BEEKEEPING, type QuestionType, type TestDocument
} from '@ielts/shared';
import { McpServer } from '@modelcontextprotocol/server';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { buildHistory } from '../attempts/history';
import { rescoreTestAttempts } from '../attempts/service';
import type { Db } from '../db/client';
import { attempts } from '../db/schema';
import { prepareImport } from '../import/service';
import { createTest, getTest, listTests, replaceTest, setTestStatus } from '../tests/repository';
import { attemptDetail, latestSubmittedAttemptId, listAttemptLines } from './attempts';
import { fail, logged, ok } from './common';
import { registerStudyTools } from './study-tools';
import { logFeedbackMistakes } from '../study/feedback-log';

export const SERVER_VERSION = '1.0.0';

const TestId = z.uuid({ error: 'must be a test id (a uuid) from list_tests' });
const AttemptId = z.uuid({ error: 'must be an attempt id (a uuid) from list_attempts' });
const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}/, { error: 'must be a date like 2026-11-01' });
const TestInput = z.union([z.record(z.string(), z.unknown()), z.string()], { error: 'must be the test as a JSON object (or a JSON / text-format string)' });

/** [14, 15, 16] -> "Q14–16 " */
const qRange = (n: number[]) => (!n.length ? '' : Math.min(...n) === Math.max(...n) ? `Q${n[0]} ` : `Q${Math.min(...n)}–${Math.max(...n)} `);

const sourceOf = (test: Record<string, unknown> | string) => (typeof test === 'string' ? test : JSON.stringify(test));

/** top-level fields replace; answerKey entries merge per question id; null removes a field or a key entry */
export function applyChanges(doc: TestDocument, changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = structuredClone(doc) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'answerKey' && v && typeof v === 'object' && !Array.isArray(v)) {
      const key = { ...(out.answerKey as Record<string, unknown>) };
      for (const [qid, entry] of Object.entries(v as Record<string, unknown>)) {
        if (entry === null) delete key[qid];
        else key[qid] = entry;
      }
      out.answerKey = key;
    } else if (v === null) {
      delete out[k];
    } else {
      out[k] = v;
    }
  }
  return out;
}

const FORMAT_RULES = [
  'A test is one JSON object: { title, skill, kind, variant?, timeLimitMin?, instructions?, dueDate?, parts: [...], answerKey: {...} }.',
  'skill: reading | listening | writing | speaking | mixed (a full mock: then every part needs "skill"). kind: homework | practice | full_mock. variant: academic (default) | general_training. dueDate: "YYYY-MM-DD". timeLimitMin: whole-test countdown; leave it out for no clock.',
  'A part: { id, title, instructions?, timeLimitMin?, passage? (reading), transcript?/audioUrl? (listening), questionGroups: [...] }.',
  'Ids start with a letter and use letters, digits, "-" or "_"; every id (parts, groups, questions) is unique in the whole test. Question numbers run 1, 2, 3… through the whole test in order; mcq_multi questions take one number per correct option: "numbers": [14, 15].',
  'Reading parts need passage: { title?, subtitle?, paragraphs: [{ label?: "A", heading?, text }] }. **bold** and *italic* work in all texts.',
  'Listening parts need "transcript" unless the part, or an earlier part, has "audioUrl". You cannot upload audio, so write a transcript: the browser reads it aloud (once in exam mode) and shows it only after submission. Put each turn on its own line as "Speaker: words" (e.g. "Narrator: …", "Receptionist: …", "Tom: …"); each speaker gets a different voice. Use [square brackets] for stage directions you do not want read.',
  'writing_task2 with "mode": "plan_intro" is the drill: a plan (planTimeMin, default 5) then an introduction (introTimeMin, default 10), each with its own timer. Speaking: Part 1/3 questions are recorded one by one; Part 2 has a cue card with a preparation timer (prepTimeSec, 60) and a talk timer (talkTimeSec, 120).',
  'answerKey: { "<questionId>": { "accept": ["…"], "explanation"?: "…" } } for EVERY objective question. TFNG: TRUE / FALSE / NOT GIVEN; YNNG: YES / NO / NOT GIVEN; multiple choice: option letters (A = first option); matching and word-box completion: option labels; mcq_multi: exactly as many letters as numbers.',
  'Free-text answers: list every acceptable form as separate strings; brackets mark optional words: "(the) dark surfaces". Matching ignores case, extra spaces and a final full stop; "1,000" = "1000". Spelling counts.',
  'wordLimit: { maxWords, allowNumber } — an answer over the limit is marked wrong, like the real test, so every key answer must fit the limit. Say the limit in the instructions too (e.g. "NO MORE THAN TWO WORDS AND/OR A NUMBER").',
  'Completion groups: either questions with "text" containing ______ where the gap is, or a "template" with {{questionId}} at each gap. Template lines: "# heading", "- bullet", "a | b | c" table rows (first row = header), "> flow-chart box".',
  'Writing (writing_task1, writing_task2, paragraph) and speaking groups are marked by you later: no "accept"; put "modelAnswer" / "notes" in answerKey under the writing group id or the speaking question id. Task 1 charts are data (chartType line | bar | pie | table | process | map) drawn by the site.',
  'If the test is not valid, nothing is saved and every problem is listed with its path (e.g. parts[0].questionGroups[1].questions[2].number). Fix all of them and call create_test again.'
];

export function buildMcpServer(db: Db, origin: string): McpServer {
  const server = new McpServer(
    { name: 'ielts-practice', version: SERVER_VERSION },
    {
      instructions: 'The student\'s private IELTS Academic practice site. Use it to upload tests and homework (call get_test_format first), and to mark attempts: get_latest_attempt or get_attempt gives every answer with the correct answer and the reason; then save_feedback (mistakes with "addToLog": true also go into the mistakes log). The site also keeps the student\'s lessons (create_lesson, list_lessons), vocabulary sets with a self-test log (upsert_vocab_set, record_vocab_result, update_word) and a mistakes log of misspellings, grammar slips and reading traps (add_mistakes, list_mistakes). Links in results open the student\'s site.'
    }
  );
  const testUrl = (id: string) => `${origin}/#/test/${id}`;
  const RO = { readOnlyHint: true, openWorldHint: false } as const;

  /* ---------- format ---------- */
  const FormatArgs = z.object({
    types: z.array(z.enum(QUESTION_TYPES)).optional().describe('only these question types (default: all)'),
    jsonSchema: z.boolean().optional().describe('also return the full JSON Schema of a test (long)')
  });
  server.registerTool('get_test_format', {
    title: 'Get the test format',
    description: 'Call this before writing a test. Returns the rules of the test format, one small valid example per question type (group + answer key), and a complete example test.',
    inputSchema: FormatArgs,
    annotations: RO
  }, logged('get_test_format', async (a: z.infer<typeof FormatArgs>) => {
    const types = (a.types?.length ? a.types : QUESTION_TYPES) as readonly QuestionType[];
    return ok({
      rules: FORMAT_RULES,
      questionTypes: Object.fromEntries(types.map(t => [t, QUESTION_TYPE_EXAMPLES[t]])),
      completeExample: URBAN_BEEKEEPING,
      ...(a.jsonSchema ? { jsonSchema: z.toJSONSchema(TestDocumentSchema, { io: 'input', unrepresentable: 'any' }) } : {})
    });
  }));

  /* ---------- tests ---------- */
  const CreateArgs = z.object({ test: TestInput.describe('the complete test (see get_test_format)') });
  server.registerTool('create_test', {
    title: 'Upload a test',
    description: 'Validate and save a new test or homework on the student\'s site; it appears on their dashboard at once. Returns its id and link. If the test is not valid nothing is saved, and every problem is listed with its path.',
    inputSchema: CreateArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, logged('create_test', async (a: z.infer<typeof CreateArgs>) => {
    const r = prepareImport(sourceOf(a.test));
    if (!r.ok) return fail('The test is not valid. Nothing was saved. Fix every problem below and call create_test again:', r.errors);
    const saved = await createTest(db, r.doc, { source: 'claude' });
    console.log(`[mcp] test ${saved.id} created: "${saved.test.title}"`);
    return ok({
      id: saved.id, title: saved.test.title, url: testUrl(saved.id),
      summary: r.summary && { skill: r.summary.skill, kind: r.summary.kind, questions: r.summary.marks, timeLimitMin: r.summary.timeLimitMin, dueDate: r.summary.dueDate, parts: r.summary.parts.map(p => ({ title: p.title, groups: p.groups.map(g => `${qRange(g.numbers)}${g.type}`) })) },
      warnings: r.warnings.map(w => `${w.path}: ${w.message}`)
    });
  }));

  const UpdateArgs = z.object({
    id: TestId,
    changes: z.record(z.string(), z.unknown()).optional().describe('only the top-level fields to change, e.g. { "answerKey": { "q7": { "accept": ["FALSE"] } } } or { "dueDate": "2026-12-01" }. answerKey entries merge per question id; null removes a field or an entry. "parts" replaces all parts.'),
    test: TestInput.optional().describe('instead of "changes": the complete new version of the test')
  });
  server.registerTool('update_test', {
    title: 'Fix a test',
    description: 'Fix an existing test, e.g. a wrong answer in the key or a typo. Send "changes" (just the fields to change) or "test" (the full new version). Attempts already submitted are re-scored with the new answer key.',
    inputSchema: UpdateArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, logged('update_test', async (a: z.infer<typeof UpdateArgs>) => {
    if (!a.changes === !a.test) return fail('Send exactly one of "changes" or "test".');
    const current = await getTest(db, a.id);
    if (!current) return fail(`There is no test with id ${a.id}. Use list_tests to find it.`);
    const source = a.test !== undefined ? sourceOf(a.test) : JSON.stringify(applyChanges(current.document, a.changes!));
    const r = prepareImport(source);
    if (!r.ok) return fail('The updated test is not valid. Nothing was changed. Fix every problem below and call update_test again:', r.errors);
    const saved = await replaceTest(db, a.id, r.doc);
    if (!saved) return fail(`There is no test with id ${a.id}.`);
    const rescored = await rescoreTestAttempts(db, a.id);
    const open = await db.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.testId, a.id), eq(attempts.status, 'in_progress')));
    console.log(`[mcp] test ${a.id} updated; ${rescored} attempt(s) re-scored`);
    return ok({
      id: a.id, title: saved.test.title, url: testUrl(a.id), rescoredAttempts: rescored,
      ...(open.length ? { note: `${open.length} attempt(s) in progress will use the new version from the next save; answers to questions whose id changed are kept but no longer shown.` } : {}),
      warnings: r.warnings.map(w => `${w.path}: ${w.message}`)
    });
  }));

  const ListTestsArgs = z.object({
    skill: z.enum(SKILLS).optional(), kind: z.enum(KINDS).optional(), status: z.enum(STATUSES).optional(),
    limit: z.number().int().min(1).max(100).optional().describe('default 20')
  });
  server.registerTool('list_tests', {
    title: 'List tests',
    description: 'The tests on the site, newest first: id, title, skill, kind, status, question count, attempts, link.',
    inputSchema: ListTestsArgs,
    annotations: RO
  }, logged('list_tests', async (a: z.infer<typeof ListTestsArgs>) => {
    const list = await listTests(db, { ...(a.skill ? { skill: a.skill } : {}), ...(a.kind ? { kind: a.kind } : {}), ...(a.status ? { status: a.status } : {}), limit: a.limit ?? 20 });
    return ok({ tests: list.map(t => ({ id: t.id, title: t.title, skill: t.skill, kind: t.kind, status: t.status, source: t.source, dueDate: t.dueDate, questions: t.marks, attempts: t.attemptCount, created: t.createdAt.toISOString(), url: testUrl(t.id) })) });
  }));

  const IdArgs = z.object({ id: TestId });
  server.registerTool('get_test', {
    title: 'Get a test',
    description: 'One test in full, including the answer key, in the same format as create_test.',
    inputSchema: IdArgs,
    annotations: RO
  }, logged('get_test', async (a: z.infer<typeof IdArgs>) => {
    const t = await getTest(db, a.id);
    if (!t) return fail(`There is no test with id ${a.id}. Use list_tests to find it.`);
    return ok({ id: t.id, status: t.status, source: t.source, created: t.createdAt.toISOString(), updated: t.updatedAt.toISOString(), url: testUrl(t.id), test: t.document });
  }));

  server.registerTool('archive_test', {
    title: 'Archive a test',
    description: 'Hide a test from the dashboard. Nothing is deleted: its attempts and results stay, and the student can restore it on the Tests page.',
    inputSchema: IdArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, logged('archive_test', async (a: z.infer<typeof IdArgs>) => {
    const row = await setTestStatus(db, a.id, 'archived');
    if (!row) return fail(`There is no test with id ${a.id}.`);
    return ok({ id: a.id, status: 'archived' });
  }));

  /* ---------- attempts ---------- */
  const ListAttemptsArgs = z.object({
    testId: TestId.optional(),
    status: z.enum(['in_progress', 'submitted', 'marked']).optional().describe('marked = feedback already saved'),
    since: DateStr.optional().describe('only attempts submitted (or still in progress and saved) on or after this date'),
    limit: z.number().int().min(1).max(100).optional().describe('default 20')
  });
  server.registerTool('list_attempts', {
    title: 'List attempts',
    description: 'The student\'s attempts, newest first: id, test, status, score, estimated band, dates, whether feedback is saved.',
    inputSchema: ListAttemptsArgs,
    annotations: RO
  }, logged('list_attempts', async (a: z.infer<typeof ListAttemptsArgs>) => ok({
    attempts: await listAttemptLines(db, origin, {
      ...(a.testId ? { testId: a.testId } : {}), ...(a.status ? { status: a.status } : {}),
      ...(a.since ? { since: new Date(a.since) } : {}), limit: a.limit ?? 20
    })
  })));

  const AttemptArgs = z.object({ id: AttemptId });
  server.registerTool('get_attempt', {
    title: 'Get an attempt',
    description: 'Everything needed to mark one attempt: each question with its text, the student\'s exact answer, the correct answers, the result and its reason (wrong, blank, over_word_limit, likely_spelling), writing and speaking answers with word counts, time per part, and any saved feedback.',
    inputSchema: AttemptArgs,
    annotations: RO
  }, logged('get_attempt', async (a: z.infer<typeof AttemptArgs>) => ok(await attemptDetail(db, a.id, origin))));

  const LatestArgs = z.object({ skill: z.enum(SKILLS).optional().describe('only attempts of this skill') });
  server.registerTool('get_latest_attempt', {
    title: 'Get the latest attempt',
    description: 'The student\'s most recently submitted attempt in full (same as get_attempt). Use it for "mark my last attempt".',
    inputSchema: LatestArgs,
    annotations: RO
  }, logged('get_latest_attempt', async (a: z.infer<typeof LatestArgs>) => {
    const id = await latestSubmittedAttemptId(db, a.skill);
    if (!id) return fail(a.skill ? `No submitted ${a.skill} attempt yet.` : 'No submitted attempt yet.');
    return ok(await attemptDetail(db, id, origin));
  }));

  const FeedbackArgs = z.object({ attemptId: AttemptId, feedback: Feedback });
  server.registerTool('save_feedback', {
    title: 'Save feedback',
    description: 'Save your marking of a submitted attempt. It shows on the student\'s results page, and the attempt becomes "marked". Saving again replaces the earlier feedback. A mistake with "addToLog": true, "yourAnswer", "correct" and a category (spelling, grammar, capitals, word choice, collocation, reading trap) is also filed in the mistakes log ("rule", or else the explanation, becomes its rule); saving again does not count it twice. criteria keys: Writing TR (or TA for Task 1), CC, LR, GRA; Speaking FC, LR, GRA, P. Bands are whole or half numbers.',
    inputSchema: FeedbackArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
  }, logged('save_feedback', async (a: z.infer<typeof FeedbackArgs>) => {
    const [row] = await db.select({ status: attempts.status, answers: attempts.answers }).from(attempts).where(eq(attempts.id, a.attemptId)).limit(1);
    if (!row) return fail(`There is no attempt with id ${a.attemptId}. Use list_attempts to find it.`);
    if (row.status === 'in_progress') return fail('This attempt is not submitted yet. Feedback can be saved after the student submits it.');
    const detail = await attemptDetail(db, a.attemptId, origin);
    const ids = new Set([
      ...((detail.questions as Array<{ id: string }>) ?? []).map(q => q.id),
      ...((detail.writingAndSpeaking as Array<{ id: string }>) ?? []).map(o => o.id)
    ]);
    const unknown = a.feedback.mistakes.map(m => m.questionId).filter((q): q is string => !!q && !ids.has(q));
    const now = new Date();
    await db.update(attempts).set({ feedback: { ...a.feedback, savedAt: now.toISOString() }, status: 'marked', updatedAt: now })
      .where(and(eq(attempts.id, a.attemptId), inArray(attempts.status, ['submitted', 'marked'])));
    const log = await logFeedbackMistakes(db, a.attemptId, (detail as { test?: { title?: string } }).test?.title ?? '', a.feedback.mistakes, now);
    return ok({
      saved: true, attemptId: a.attemptId, resultsUrl: `${origin}/#/result/${a.attemptId}`,
      ...(log ? { mistakesLog: log } : {}),
      ...(unknown.length ? { warning: `These questionIds are not in this attempt: ${[...new Set(unknown)].join(', ')}` } : {})
    });
  }));

  /* ---------- progress ---------- */
  const ProgressArgs = z.object({ skill: z.enum(SECTION_SKILLS).optional(), since: DateStr.optional() });
  server.registerTool('get_progress', {
    title: 'Get progress',
    description: 'Progress over time: estimated bands per skill (latest, best, average of the last 5, each attempt), accuracy per question type with the recent trend, how often each kind of mistake happens (auto-marking reasons), and the categories of the mistakes in your saved feedback.',
    inputSchema: ProgressArgs,
    annotations: RO
  }, logged('get_progress', async (a: z.infer<typeof ProgressArgs>) => {
    const h = await buildHistory(db, { ...(a.skill ? { skill: a.skill } : {}), ...(a.since ? { since: new Date(a.since) } : {}) });
    const pct = (raw: number, total: number) => (total ? Math.round((raw / total) * 100) : null);
    return ok({
      attempts: h.attempts.length,
      bySkill: Object.fromEntries(Object.entries(h.bySkill).map(([k, v]) => [k, { ...v, points: v.points.slice(-15) }])),
      byQuestionType: h.byType.map(t => ({ type: t.type, correct: t.raw, total: t.total, accuracyPct: pct(t.raw, t.total), last3AttemptsPct: pct(t.recent.raw, t.recent.total), trendPoints: t.trend })),
      mistakeReasons: h.reasons,
      feedbackMistakeCategories: h.feedbackMistakes
    });
  }));

  registerStudyTools(server, db, origin);
  return server;
}
