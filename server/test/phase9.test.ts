import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, Feedback, listItems, scoreAnswers, validateTest, type ResultView } from '@ielts/shared';
import { eq } from 'drizzle-orm';
import { attempts } from '../src/db/schema';
import { attemptDetail } from '../src/mcp/attempts';
import { getVocabSet, upsertVocabSet } from '../src/study/store';
import { wordOfQuestion } from '../src/study/vocab-quiz';
import { createTest } from '../src/tests/repository';
import { Client, startServer, type TestServer } from './helpers';

let srv: TestServer;
let me: Client;
const json = async <T>(r: Response) => (await r.json()) as T;

beforeAll(async () => {
  srv = await startServer();
  me = new Client(srv.url);
  expect((await me.login()).status).toBe(200);
});
afterAll(async () => { await srv.close(); });

const QUIZ = {
  title: 'Set 3 quiz', skill: 'vocabulary', kind: 'homework', vocabularySetId: 'set-3',
  parts: [{
    id: 'v1', title: 'Set 3',
    questionGroups: [
      { id: 'g1', type: 'definition_match', instructions: 'Match.', options: [{ label: 'A', text: 'make less severe' }, { label: 'B', text: 'make worse' }, { label: 'C', text: 'harmful' }], questions: [{ id: 'q1', number: 1, text: 'mitigate' }, { id: 'q2', number: 2, text: 'exacerbate' }, { id: 'q3', number: 3, text: 'detrimental' }] },
      { id: 'g2', type: 'sentence_completion', instructions: 'One word.', questions: [{ id: 'q4', number: 4, text: 'Aid can ______ poverty.' }] }
    ]
  }],
  answerKey: { q1: { accept: ['A'] }, q2: { accept: ['B'] }, q3: { accept: ['C'] }, q4: { accept: ['alleviate'] } }
};

describe('test format (Phase 9)', () => {
  it('a vocabulary quiz needs no passage, has no band, and only takes the vocabulary types', () => {
    const r = validateTest(QUIZ);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.test.vocabularySetId).toBe('set-3');
    const s = scoreAnswers('vocabulary', { variant: 'academic', parts: r.test.parts }, r.test.answerKey, { q1: 'A', q2: 'C', q3: 'C', q4: 'alleviate' });
    expect(s).toMatchObject({ raw: 3, total: 4, band: null });
    expect(s.perType.definition_match).toEqual({ raw: 2, total: 3 });

    const bad = validateTest({ ...QUIZ, parts: [{ ...QUIZ.parts[0], questionGroups: [{ id: 'g1', type: 'tfng', questions: [{ id: 'q1', number: 1, text: 'x' }] }] }], answerKey: { q1: { accept: ['TRUE'] } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map(e => e.message).join(' ')).toContain('cannot be used in a vocabulary quiz');
    const passage = validateTest({ ...QUIZ, parts: [{ ...QUIZ.parts[0], passage: { paragraphs: [{ text: 'x' }] } }] });
    expect(passage.ok).toBe(false);
  });

  it('every example of get_test_format is valid, including the three new types', () => {
    for (const t of ['definition_match', 'opposite_match', 'sentence_rewrite'] as const) {
      const r = validateTest(exampleTestForType(t));
      expect(r.ok, `${t}: ${JSON.stringify(!r.ok && r.errors)}`).toBe(true);
    }
  });

  it('sentence_rewrite: one open item per sentence; the key takes model answers, not "accept"', () => {
    const ex = exampleTestForType('sentence_rewrite');
    const r = validateTest(ex);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(listItems(r.test.parts).map(i => [i.id, i.kind])).toEqual([['r1', 'writing'], ['r2', 'writing']]);
    const bad = validateTest({ ...ex, answerKey: { r1: { accept: ['x'] } } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]!.message).toContain('marked by Claude');
  });

  it('feedback takes per-item results', () => {
    expect(Feedback.parse({ summary: 'ok', items: [{ itemId: 'r1', correct: true, comment: 'good' }] }).items?.[0]).toMatchObject({ itemId: 'r1', correct: true });
    expect(Feedback.safeParse({ summary: 'ok', items: [{ correct: true }] }).success).toBe(false);
  });

  it('finds the word a question is about', () => {
    const words = ['mitigate', 'alleviate', 'exacerbate'];
    expect(wordOfQuestion('Mitigate', ['A'], words)).toBe('mitigate');
    expect(wordOfQuestion('Which word means "ease"? alleviate or worsen', [], words)).toBe('alleviate');
    expect(wordOfQuestion('Aid can ______ poverty.', ['(to) alleviate'], words)).toBe('alleviate');
    expect(wordOfQuestion('nothing here', ['B'], words)).toBeNull();
  });
});

describe('vocabulary quizzes, plan box, study blocks (Phase 9)', () => {
  it('a submitted quiz writes the self-test log: missed words weak, right words move on', async () => {
    await upsertVocabSet(srv.database.db, { id: 'set-3', number: 3, theme: 'Effects', words: [
      { word: 'mitigate', meaning: 'make less severe', opposite: 'aggravate' }, { word: 'exacerbate', meaning: 'make worse', opposite: 'ease' },
      { word: 'detrimental', meaning: 'harmful', opposite: 'beneficial', status: 'learning' }, { word: 'alleviate', meaning: 'ease pain', status: 'weak' }] });
    const { id: testId } = await createTest(srv.database.db, QUIZ, { source: 'claude' });
    const att = await json<{ id: string }>(await me.post(`/api/tests/${testId}/attempts`, { mode: 'practice' }));
    expect((await me.post(`/api/attempts/${att.id}/submit`, { answers: { q1: 'A', q2: 'C', q3: 'C', q4: 'aleviate' } })).status).toBe(200);
    const v = (await getVocabSet(srv.database.db, 'set-3'))!;
    expect(v.results[0]).toMatchObject({ quiz: 1, score: 2, total: 4, attemptId: att.id });
    expect(v.results[0]!.weakWords.sort()).toEqual(['alleviate', 'exacerbate']);
    expect(Object.fromEntries(v.set.words.map(w => [w.word, [w.status, w.timesMissed]]))).toEqual({
      mitigate: ['learning', 0], exacerbate: ['weak', 1], detrimental: ['learned', 0], alleviate: ['weak', 1]
    });
    expect(v.tests.map(t => t.id)).toContain(testId);
    // viewing the result again does not log it twice
    const r = await json<ResultView>(await me.get(`/api/attempts/${att.id}/result`));
    expect(r.autoScore.band).toBeNull();
    expect((await getVocabSet(srv.database.db, 'set-3'))!.results).toHaveLength(1);
  });

  it('"Test me" makes a quiz from the set (and reuses it until it is used)', async () => {
    const a = await json<{ testId: string; reused: boolean }>(await me.post('/api/vocab/sets/set-3/quiz', {}));
    expect(a.reused).toBe(false);
    const b = await json<{ testId: string; reused: boolean }>(await me.post('/api/vocab/sets/set-3/quiz', {}));
    expect(b).toEqual({ testId: a.testId, reused: true });
    const t = await json<{ test: { skill: string; marks: number } }>(await me.get(`/api/tests/${a.testId}`));
    expect(t.test).toMatchObject({ skill: 'vocabulary', marks: 4 + 3 }); // 4 words with a meaning, 3 with an opposite
  });

  it('get_attempt: the Task 2 plan, the study blocks and each rewrite sentence', async () => {
    const { id: testId } = await createTest(srv.database.db, {
      title: 'Writing mix', skill: 'writing', kind: 'homework',
      parts: [{ id: 'p1', title: 'Task 2', questionGroups: [{ id: 'essay', type: 'writing_task2', prompt: 'Parks or roads?' }] },
        { id: 'p2', title: 'Repair', questionGroups: [{ id: 'rw', type: 'sentence_rewrite', instructions: 'Fix each.', items: [{ id: 'r1', number: 1, text: 'He go home.' }, { id: 'r2', number: 2, text: 'She are late.' }] }] }],
      answerKey: { r1: { modelAnswer: 'He goes home.' } }
    }, { source: 'claude' });
    const att = await json<{ id: string }>(await me.post(`/api/tests/${testId}/attempts`, { mode: 'practice' }));
    const blocks = [{ start: '2026-11-18T08:00:00.000Z', end: '2026-11-18T08:15:00.000Z', sec: 880, words: 120 }];
    await me.patch(`/api/attempts/${att.id}`, { answers: { essay: 'Parks matter.', r1: 'He goes home.' }, state: { 'plan:essay': 'For parks: health, air', blocks } });
    await me.post(`/api/attempts/${att.id}/submit`, {});
    const d = await attemptDetail(srv.database.db, att.id, srv.url) as Record<string, any>;
    const essay = d.writingAndSpeaking.find((o: { id: string }) => o.id === 'essay');
    expect(essay.plan).toBe('For parks: health, air');
    expect(d.studyBlocks).toEqual([{ start: blocks[0]!.start, end: blocks[0]!.end, activeMinutes: 14.7, words: 120 }]);
    const r1 = d.writingAndSpeaking.find((o: { id: string }) => o.id === 'r1');
    expect(r1).toMatchObject({ type: 'sentence_rewrite', answer: 'He goes home.', modelAnswer: 'He goes home.' });
    expect(r1.task).toContain('1. He go home.');
    expect(d.writingAndSpeaking.map((o: { id: string }) => o.id)).toEqual(['essay', 'r1', 'r2']);
    const [row] = await srv.database.db.select().from(attempts).where(eq(attempts.id, att.id));
    expect(row!.status).toBe('submitted');
  });
});
