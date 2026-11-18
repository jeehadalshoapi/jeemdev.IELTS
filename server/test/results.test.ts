import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, type DashboardResponse, type HistoryResponse, type ResultView } from '@ielts/shared';
import { eq, sql } from 'drizzle-orm';
import { rescoreTestAttempts } from '../src/attempts/service';
import { attempts, tests } from '../src/db/schema';
import { SAMPLE_TEST_ID, seedSample } from '../src/seed';
import { createTest } from '../src/tests/repository';
import { Client, startServer, type TestServer } from './helpers';

let srv: TestServer;
let me: Client;
const json = async <T>(r: Response) => (await r.json()) as T;
const start = async (testId: string, mode = 'practice') => (await json<{ id: string }>(await me.post(`/api/tests/${testId}/attempts`, { mode }))).id;

beforeAll(async () => {
  srv = await startServer();
  await seedSample(srv.database.db);
  me = new Client(srv.url);
  expect((await me.login()).status).toBe(200);
});
afterAll(async () => { await srv.close(); });

describe('scoring and results', () => {
  it('has no results before submission', async () => {
    const id = await start(SAMPLE_TEST_ID);
    const r = await me.get(`/api/attempts/${id}/result`);
    expect(r.status).toBe(409);
    expect((await json<{ error: string }>(r)).error).toBe('not_submitted');
  });

  it('scores on submit, keeping the exact answer and the reason for every mistake', async () => {
    const id = await start(SAMPLE_TEST_ID);
    await me.patch(`/api/attempts/${id}`, { answers: { q1: 'iii', q6: 'TRUE', q7: 'FALSE', q11: 'Register.', q12: 'permits', q15: ['A', 'E'], q17: 'the colony collapse disorder' } });
    expect((await me.post(`/api/attempts/${id}/submit`, {})).status).toBe(200);
    const r = await json<ResultView>(await me.get(`/api/attempts/${id}/result`));
    const q = (n: number) => r.autoScore.questions.find(x => x.number === n)!;
    expect(r.autoScore).toMatchObject({ raw: 4, total: 17 });
    expect(r.autoScore.band).toBe(3.5); // 4/17 scales to 9/40 -> band 3.5 (Academic Reading)
    expect(r.autoScore.bandInfo).toMatchObject({ scaledRaw: 9, basedOn: 17, scaled: true });
    expect(q(11)).toMatchObject({ answer: 'Register.', correct: true });
    expect(q(7)).toMatchObject({ answer: 'FALSE', correct: false, reason: 'wrong', correctAnswers: ['NOT GIVEN'] });
    expect(q(7).explanation).toContain('North America and Europe');
    expect(q(12)).toMatchObject({ answer: 'permits', reason: 'likely_spelling' });
    expect(q(17)).toMatchObject({ answer: 'the colony collapse disorder', reason: 'over_word_limit', note: '4 words — limit: NO MORE THAN THREE WORDS' });
    expect([q(15).correct, q(16).correct]).toEqual([true, false]);
    expect(r.autoScore.reasons).toMatchObject({ correct: 4, wrong: 2, likely_spelling: 1, over_word_limit: 1, blank: 9 });
    expect(r.attempt.timeUsedSec).toBeGreaterThanOrEqual(0);

    const d = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(d.completed.find(a => a.id === id)?.autoScore).toEqual({ raw: 4, total: 17, band: r.autoScore.band });
  });

  it('shows the listening transcript only after submission', async () => {
    const { id: testId } = await createTest(srv.database.db, exampleTestForType('form_completion'), { source: 'claude' });
    const id = await start(testId);
    expect(await (await me.get(`/api/attempts/${id}`)).text()).not.toContain('transcript');
    await me.post(`/api/attempts/${id}/submit`, { answers: { q1: 'Mitchell', q2: '07700 900123' } });
    const r = await json<ResultView>(await me.get(`/api/attempts/${id}/result`));
    expect(r.test.content.parts[0]?.transcript).toContain('Narrator');
    expect(r.autoScore).toMatchObject({ raw: 2, total: 2, band: 9 });
    expect(r.autoScore.bandInfo?.table).toBe('listening');
  });

  it('scores an exam that ran out of time with the answers saved so far', async () => {
    const id = await start(SAMPLE_TEST_ID, 'exam');
    await me.patch(`/api/attempts/${id}`, { answers: { q1: 'iii', q2: 'i' } });
    await srv.database.db.update(attempts).set({ startedAt: sql`now() - interval '30 minutes'` }).where(eq(attempts.id, id));
    const r = await json<ResultView>(await me.get(`/api/attempts/${id}/result`));
    expect(r.attempt.autoSubmitted).toBe(true);
    expect(r.autoScore).toMatchObject({ raw: 2, total: 17 });
    expect(r.attempt.timeUsedSec).toBe(20 * 60);
  });

  it('scores older attempts that were submitted before scoring existed', async () => {
    const [row] = await srv.database.db.insert(attempts).values({ testId: SAMPLE_TEST_ID, status: 'submitted', submittedAt: new Date(), answers: { q6: 'TRUE' } }).returning();
    const r = await json<ResultView>(await me.get(`/api/attempts/${row!.id}/result`));
    expect(r.autoScore.raw).toBe(1);
    const [stored] = await srv.database.db.select().from(attempts).where(eq(attempts.id, row!.id));
    expect((stored?.autoScore as { raw: number }).raw).toBe(1);
  });

  it('re-scores attempts when the answer key is corrected', async () => {
    const { id: testId } = await createTest(srv.database.db, exampleTestForType('tfng'), { source: 'claude' });
    const id = await start(testId);
    await me.post(`/api/attempts/${id}/submit`, { answers: { q1: 'FALSE' } });
    expect((await json<ResultView>(await me.get(`/api/attempts/${id}/result`))).autoScore.raw).toBe(0);
    await srv.database.db.update(tests).set({ answerKey: { q1: { accept: ['FALSE'] } } }).where(eq(tests.id, testId));
    expect(await rescoreTestAttempts(srv.database.db, testId)).toBe(1);
    expect((await json<ResultView>(await me.get(`/api/attempts/${id}/result`))).autoScore.raw).toBe(1);
  });

  it('history: scores per skill over time, accuracy per question type, mistake reasons', async () => {
    const h = await json<HistoryResponse>(await me.get('/api/history'));
    expect(h.attempts.every(a => a.status !== 'in_progress')).toBe(true);
    expect(h.bySkill.reading?.attempts).toBeGreaterThanOrEqual(3);
    expect(h.bySkill.listening?.points[0]).toMatchObject({ band: 9, raw: 2, total: 2 });
    const tfng = h.byType.find(t => t.type === 'tfng');
    expect(tfng?.total).toBeGreaterThanOrEqual(4);
    expect(h.reasons.over_word_limit).toBeGreaterThanOrEqual(1);
    expect(h.reasons.likely_spelling).toBeGreaterThanOrEqual(1);
  });
});
