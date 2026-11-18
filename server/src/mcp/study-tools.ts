/*
 * Connector tools for lessons, the vocabulary bank and the mistakes log (Phase 8, ielts-site-spec.md items 1–3).
 * Objects are taken as plain JSON and checked with the shared zod schemas, so a refusal lists every problem with its path.
 */
import { LESSON_KINDS, LESSON_SKILLS, MISTAKE_CATEGORIES, MistakeInput, WORD_STATUSES } from '@ielts/shared';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { Db } from '../db/client';
import {
  addMistakes, getLesson, getVocabSet, listLessons, listMistakes, listVocabSets, recordVocabResult, saveLesson, updateLesson,
  updateMistake, updateWord, upsertVocabSet
} from '../study/store';
import { fail, logged, ok } from './common';

const Obj = (what: string) => z.record(z.string(), z.unknown(), { error: `must be the ${what} as a JSON object` });
const SlugArg = (what: string) => z.string().min(1).max(80).describe(what);
const RO = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const LESSON_FORMAT = 'Lesson: { id: "day23-band-6-7-8", title, day?: 23, week?: "writing", skill?: reading|listening|writing|speaking|vocabulary|general, kind: "lesson" | "reference" (permanent pages: methods, rules, phrase banks), summary?: one line for the list, sections: [ { heading?, markdown? ("**bold**", "*italic*", "- " bullets, "1. " steps, "# " sub-heading), table?: { header: [..], rows: [[..]] }, examples?: [{ label?, text, notes?: [..] }], tip?: "highlighted box text" } ], relatedTestIds?: [test uuids], vocabularySetIds?: ["set-3"] }.';
const SET_FORMAT = 'Set: { id: "set-3", number?: 3, theme: "Good and bad effects", studyDay?: 23, words: [ { word, pos?: "v", arabic?, meaning?, opposite?, trap?: "mitigate risks/effects; alleviate pain/poverty", example?, status?: new|learning|learned|weak, timesMissed? } ] }.';

export function registerStudyTools(server: McpServer, db: Db, origin: string): void {
  const lessonUrl = (id: string) => `${origin}/#/lesson/${encodeURIComponent(id)}`;
  const setUrl = (id: string) => `${origin}/#/vocab/${encodeURIComponent(id)}`;

  /* ---------- lessons ---------- */
  const CreateLessonArgs = z.object({ lesson: Obj('lesson').describe(LESSON_FORMAT) });
  server.registerTool('create_lesson', {
    title: 'Create a lesson',
    description: `Save a new lesson or reference page on the student's Lessons page (grouped by week and day, searchable). ${LESSON_FORMAT} Fails if the id exists (use update_lesson).`,
    inputSchema: CreateLessonArgs,
    annotations: WRITE
  }, logged('create_lesson', async (a: z.infer<typeof CreateLessonArgs>) => {
    const { lesson } = await saveLesson(db, a.lesson, 'create');
    return ok({ saved: true, id: lesson.id, url: lessonUrl(lesson.id), sections: lesson.sections.length });
  }));

  const UpdateLessonArgs = z.object({
    id: SlugArg('the lesson id'),
    changes: Obj('changes').describe('top-level fields to replace, e.g. { "sections": [...] } (the whole array) or { "summary": "…" }; null removes a field')
  });
  server.registerTool('update_lesson', {
    title: 'Update a lesson',
    description: 'Change an existing lesson: each top-level field given replaces the old one (sections is replaced as a whole — get_lesson first to edit one section).',
    inputSchema: UpdateLessonArgs,
    annotations: { ...WRITE, idempotentHint: true }
  }, logged('update_lesson', async (a: z.infer<typeof UpdateLessonArgs>) => {
    const lesson = await updateLesson(db, a.id, a.changes);
    return ok({ saved: true, id: lesson.id, url: lessonUrl(lesson.id) });
  }));

  const LessonIdArgs = z.object({ id: SlugArg('the lesson id') });
  server.registerTool('get_lesson', {
    title: 'Get a lesson',
    description: 'One lesson in full (the same JSON you would send to create_lesson), with its linked tests and vocabulary sets.',
    inputSchema: LessonIdArgs,
    annotations: RO
  }, logged('get_lesson', async (a: z.infer<typeof LessonIdArgs>) => {
    const v = await getLesson(db, a.id);
    if (!v) return fail(`There is no lesson with id "${a.id}". Use list_lessons.`);
    return ok({ ...v, url: lessonUrl(a.id) });
  }));

  const ListLessonsArgs = z.object({
    week: z.string().optional(), day: z.number().int().optional(),
    skill: z.enum(LESSON_SKILLS).optional(), kind: z.enum(LESSON_KINDS).optional()
  });
  server.registerTool('list_lessons', {
    title: 'List lessons',
    description: 'Lessons and reference pages (id, title, day, week, skill, kind, summary), ordered by day.',
    inputSchema: ListLessonsArgs,
    annotations: RO
  }, logged('list_lessons', async (a: z.infer<typeof ListLessonsArgs>) => ok({ lessons: await listLessons(db, a) })));

  /* ---------- vocabulary ---------- */
  const UpsertSetArgs = z.object({ set: Obj('vocabulary set').describe(SET_FORMAT) });
  server.registerTool('upsert_vocab_set', {
    title: 'Save a vocabulary set',
    description: `Create a vocabulary set, or replace it (same id). ${SET_FORMAT} When replacing, words that stay keep their status and miss count unless you set them; words left out are removed.`,
    inputSchema: UpsertSetArgs,
    annotations: { ...WRITE, idempotentHint: true }
  }, logged('upsert_vocab_set', async (a: z.infer<typeof UpsertSetArgs>) => {
    const r = await upsertVocabSet(db, a.set);
    return ok({ ...r, url: setUrl(r.id) });
  }));

  server.registerTool('list_vocab_sets', {
    title: 'List vocabulary sets',
    description: 'Every set: id, number, theme, study day, word count, words per status (new / learning / learned / weak) and the last self-test result.',
    inputSchema: z.object({}),
    annotations: RO
  }, logged('list_vocab_sets', async () => ok({ sets: await listVocabSets(db) })));

  const SetIdArgs = z.object({ id: SlugArg('the set id, e.g. "set-3"') });
  server.registerTool('get_vocab_set', {
    title: 'Get a vocabulary set',
    description: 'One set with every word (status, times missed), its self-test log, and the quiz tests linked to it.',
    inputSchema: SetIdArgs,
    annotations: RO
  }, logged('get_vocab_set', async (a: z.infer<typeof SetIdArgs>) => {
    const v = await getVocabSet(db, a.id);
    if (!v) return fail(`There is no vocabulary set "${a.id}". Use list_vocab_sets.`);
    return ok({ ...v, url: setUrl(a.id) });
  }));

  const ResultArgs = z.object({
    result: Obj('result').describe('{ setId: "set-1", quiz?: 1, date: "2026-11-17", score: 4, total: 7, weakWords?: ["dwindle", "proliferate"], attemptId? }')
  });
  server.registerTool('record_vocab_result', {
    title: 'Record a vocabulary self-test',
    description: 'Add a line to a set\'s self-test log. Every word in weakWords is marked "weak" and its miss count goes up by 1.',
    inputSchema: ResultArgs,
    annotations: WRITE
  }, logged('record_vocab_result', async (a: z.infer<typeof ResultArgs>) => {
    const r = await recordVocabResult(db, a.result);
    return ok({ saved: true, ...r, ...(r.unknownWords.length ? { warning: `Not in the set, so not marked: ${r.unknownWords.join(', ')}` } : {}) });
  }));

  const WordArgs = z.object({
    setId: SlugArg('the set id'),
    word: z.string().min(1).describe('the word as it is in the set (capitals do not matter)'),
    status: z.enum(WORD_STATUSES).optional(),
    timesMissed: z.number().int().min(0).optional(),
    meaning: z.string().optional(), arabic: z.string().optional(), opposite: z.string().optional(),
    trap: z.string().optional(), example: z.string().optional(), pos: z.string().optional()
  });
  server.registerTool('update_word', {
    title: 'Update a word',
    description: 'Change one word of a set: its status (new | learning | learned | weak), miss count, or any of its texts.',
    inputSchema: WordArgs,
    annotations: { ...WRITE, idempotentHint: true }
  }, logged('update_word', async (a: z.infer<typeof WordArgs>) => {
    const { setId, word, ...changes } = a;
    return ok({ saved: true, word: await updateWord(db, setId, word, changes) });
  }));

  /* ---------- mistakes log ---------- */
  const AddMistakesArgs = z.object({
    mistakes: z.array(Obj('mistake')).min(1).max(500).describe(
      `[{ category: ${MISTAKE_CATEGORIES.join(' | ')}, wrong: "experiance", correct: "experience", rule?: "experi-ence, like science and evidence", arabic?, source?: { date?, attemptId?, label? }, timesWrong? (start count for a new entry), neverAgain? }]. Reading traps: wrong = the student's answer, correct = the right one, rule = the lesson ("many ≠ most").`)
  });
  server.registerTool('add_mistakes', {
    title: 'Add to the mistakes log',
    description: 'Add entries to the student\'s mistakes log (My Mistakes page), many at once. The same wrong → correct pair is never duplicated: adding it again raises timesWrong by 1 (and makes a mastered entry active again). At 2 or more, neverAgain is set. Nothing is saved if any entry is not valid.',
    inputSchema: AddMistakesArgs,
    annotations: WRITE
  }, logged('add_mistakes', async (a: z.infer<typeof AddMistakesArgs>) => {
    const problems = a.mistakes.flatMap((m, i) => {
      const r = MistakeInput.safeParse(m);
      return r.success ? [] : r.error.issues.map(x => ({ path: `mistakes[${i}]${x.path.length ? `.${x.path.join('.')}` : ''}`, message: x.message }));
    });
    if (problems.length) return fail('Not valid, so nothing was saved. Fix every problem below and call add_mistakes again:', problems);
    const r = await addMistakes(db, a.mistakes as never);
    return ok({
      added: r.added.length, repeated: r.repeated.length,
      repeatedEntries: r.repeated.map(m => ({ id: m.id, wrong: m.wrong, correct: m.correct, timesWrong: m.timesWrong, neverAgain: m.neverAgain })),
      url: `${origin}/#/mistakes`
    });
  }));

  const ListMistakesArgs = z.object({
    category: z.enum(MISTAKE_CATEGORIES).optional(),
    status: z.enum(['active', 'mastered']).optional(),
    neverAgain: z.boolean().optional(),
    limit: z.number().int().min(1).max(2000).optional().describe('default: all')
  });
  server.registerTool('list_mistakes', {
    title: 'List the mistakes log',
    description: 'Entries of the mistakes log, "never again" ones first, then by how often they happened: id, category, wrong, correct, rule, timesWrong, neverAgain, streak (correct daily reviews in a row; 3 = mastered), status.',
    inputSchema: ListMistakesArgs,
    annotations: RO
  }, logged('list_mistakes', async (a: z.infer<typeof ListMistakesArgs>) => ok({ mistakes: await listMistakes(db, a) })));

  const UpdateMistakeArgs = z.object({
    id: z.uuid({ error: 'must be a mistake id from list_mistakes' }),
    changes: Obj('changes').describe('any of: category, wrong, correct, rule, arabic, timesWrong, neverAgain, streak, status (active | mastered)')
  });
  server.registerTool('update_mistake', {
    title: 'Update a mistake',
    description: 'Change one entry of the mistakes log (fix a rule, flag it "never again", mark it mastered …).',
    inputSchema: UpdateMistakeArgs,
    annotations: { ...WRITE, idempotentHint: true }
  }, logged('update_mistake', async (a: z.infer<typeof UpdateMistakeArgs>) => ok({ saved: true, mistake: await updateMistake(db, a.id, a.changes) })));
}
