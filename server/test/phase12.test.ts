import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  exampleTestForType, validateTest, type AttemptView, type DashboardResponse, type DictationPlay, type DoneResponse, type MasteryResponse,
  type ResultView, type TodayResponse
} from '@ielts/shared';
import { eq } from 'drizzle-orm';
import { attempts, files } from '../src/db/schema';
import { recordMasteryAttempt, upsertSteps } from '../src/study/mastery';
import { setPlan } from '../src/study/plan';
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

const newTest = async (type: Parameters<typeof exampleTestForType>[0], extra: Record<string, unknown> = {}) =>
  (await createTest(srv.database.db, { ...exampleTestForType(type), ...extra }, { source: 'claude' })).id;
const start = async (testId: string, mode = 'practice') => (await json<{ id: string }>(await me.post(`/api/tests/${testId}/attempts`, { mode }))).id;

describe('discarding an attempt started by mistake', () => {
  it('deletes an in-progress attempt with its recordings; the test stays', async () => {
    const testId = await newTest('speaking_part1');
    const id = await start(testId);
    await me.patch(`/api/attempts/${id}`, { answers: { s1q1: 'notes' } });
    const [f] = await srv.database.db.insert(files).values({ kind: 'recording', originalName: 's1q1.webm', mimeType: 'audio/webm', sizeBytes: 3, sha256: 'x', storagePath: 'gone/none.webm', attemptId: id, testId, itemId: 's1q1' }).returning();
    expect((await json<DashboardResponse>(await me.get('/api/dashboard'))).inProgress.map(a => a.id)).toContain(id);

    const r = await me.request('DELETE', `/api/attempts/${id}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, testId });
    expect((await me.get(`/api/attempts/${id}`)).status).toBe(404);
    expect(await srv.database.db.select().from(files).where(eq(files.id, f!.id))).toEqual([]);
    const d = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(d.inProgress.map(a => a.id)).not.toContain(id);
    expect(d.assigned.find(t => t.id === testId)).toMatchObject({ attemptCount: 0, inProgressAttemptId: null });
  });

  it('keeps submitted attempts, and refuses without login / CSRF', async () => {
    const testId = await newTest('tfng');
    const id = await start(testId);
    await me.post(`/api/attempts/${id}/submit`, {});
    expect((await me.request('DELETE', `/api/attempts/${id}`)).status).toBe(409);
    const other = await start(testId);
    expect((await me.request('DELETE', `/api/attempts/${other}`, undefined, { 'x-csrf-token': 'wrong' })).status).toBe(403);
    expect((await new Client(srv.url).request('DELETE', `/api/attempts/${other}`)).status).toBe(403);
    expect((await me.request('DELETE', '/api/attempts/not-a-uuid')).status).toBe(404);
  });
});

describe('dashboard = to do, Done page = finished', () => {
  it('a submitted test moves from the dashboard to the Done page', async () => {
    const testId = await newTest('short_answer', { title: 'Moves to Done' });
    let d = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(d.assigned.map(t => t.id)).toContain(testId);
    const id = await start(testId);
    await me.post(`/api/attempts/${id}/submit`, { answers: { q1: 'x' } });
    d = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(d.assigned.map(t => t.id)).not.toContain(testId);
    expect(d.doneCount).toBeGreaterThan(0);
    const done = await json<DoneResponse>(await me.get('/api/done'));
    expect(done.tests.find(t => t.id === testId)?.lastAttempt).toMatchObject({ id, status: 'submitted' });
    expect(done.completed.map(a => a.id)).toContain(id);
    // a retake in progress shows on the dashboard again
    const again = await start(testId);
    d = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(d.assigned.find(t => t.id === testId)?.inProgressAttemptId).toBe(again);
  });

  it('a mastery test stays on the dashboard until its step is passed (90 %+ twice in a row)', async () => {
    await upsertSteps(srv.database.db, [
      { id: 'v1-set3', ladder: 'V', ladderTitle: 'Vocabulary', order: 1, title: 'V1 Set 3', passRule: { minPercent: 90, inARow: 2 } },
      { id: 'v2-set4', ladder: 'V', order: 2, title: 'V2 Set 4', passRule: { minPercent: 90, inARow: 2 } }
    ]);
    const testId = await newTest('definition_match', { title: 'Set 3 quiz', masteryStepId: 'v1-set3' });
    const take = async (answers: Record<string, string>) => {
      const id = await start(testId);
      await me.post(`/api/attempts/${id}/submit`, { answers });
      return id;
    };
    await take({ q1: 'A', q2: 'B' });
    let m = await json<MasteryResponse>(await me.get('/api/mastery'));
    expect(m.ladders.find(l => l.ladder === 'V')?.current).toMatchObject({ id: 'v1-set3', passesInARow: 1, status: 'active' });
    expect(m.tests['v1-set3']?.[0]).toMatchObject({ id: testId, archived: false });
    expect((await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.find(t => t.id === testId)?.mastery).toMatchObject({ passesInARow: 1, inARow: 2 });
    await take({ q1: 'A', q2: 'A' }); // 50 %: the run starts again
    await take({ q1: 'A', q2: 'B' });
    expect((await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.map(t => t.id)).toContain(testId);
    const last = await take({ q1: 'A', q2: 'B' });
    m = await json<MasteryResponse>(await me.get('/api/mastery'));
    const v = m.ladders.find(l => l.ladder === 'V')!;
    expect(v.steps.map(s => [s.id, s.status])).toEqual([['v1-set3', 'passed'], ['v2-set4', 'active']]);
    expect(v.steps[0]!.attempts.map(a => a.percent)).toEqual([100, 50, 100, 100]);
    expect((await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.map(t => t.id)).not.toContain(testId);
    expect((await json<DoneResponse>(await me.get('/api/done'))).tests.map(t => t.id)).toContain(testId);
    // recording the same attempt again does not add it twice
    await recordMasteryAttempt(srv.database.db, last);
    expect((await json<MasteryResponse>(await me.get('/api/mastery'))).ladders.find(l => l.ladder === 'V')!.steps[0]!.attempts).toHaveLength(4);
  });
});

describe('one test per mastery attempt', () => {
  it('older submitted tests of a step go to Done; only the newest stays to practise', async () => {
    await upsertSteps(srv.database.db, [{ id: 'w1-intro', ladder: 'W', order: 1, title: 'W1 Introduction', passRule: { minBand: 7, inARow: 2 } }]);
    const first = await newTest('writing_task2', { title: 'Mastery W1 #1', masteryStepId: 'w1-intro' });
    const a1 = await start(first);
    await me.post(`/api/attempts/${a1}/submit`, {});
    let todo = (await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.map(t => t.id);
    expect(todo).toContain(first); // still the step's only test: "Try again"
    const second = await newTest('writing_task2', { title: 'Mastery W1 #2', masteryStepId: 'w1-intro' });
    todo = (await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.map(t => t.id);
    expect(todo).toContain(second);
    expect(todo).not.toContain(first);
    expect((await json<DoneResponse>(await me.get('/api/done'))).tests.map(t => t.id)).toContain(first);
  });

  it('a percent step counts the per-item marks when nothing is auto-marked (sentence rewrite)', async () => {
    await upsertSteps(srv.database.db, [{ id: 's2-cast', ladder: 'S2x', order: 1, title: 'S2 CAST correction', passRule: { minPercent: 90, inARow: 2 } }]);
    const testId = await newTest('sentence_rewrite', { masteryStepId: 's2-cast' });
    const id = await start(testId);
    await me.post(`/api/attempts/${id}/submit`, { answers: { r1: 'x', r2: 'y' } });
    expect(await recordMasteryAttempt(srv.database.db, id)).toBeNull(); // not marked yet
    await srv.database.db.update(attempts).set({ status: 'marked', feedback: { summary: 'ok', mistakes: [], nextSteps: [], items: [{ itemId: 'r1', correct: true }, { itemId: 'r2', correct: false }] } }).where(eq(attempts.id, id));
    expect((await recordMasteryAttempt(srv.database.db, id))?.entry).toMatchObject({ percent: 50, passed: false });
  });
});

describe('dictation', () => {
  it('accepts "items" as in the spec, and checks the answer key', () => {
    const r = validateTest({ title: 'S1', skill: 'vocabulary', parts: [{ id: 'p1', title: 'Spelling', questionGroups: [{ id: 'g1', type: 'dictation', items: [{ id: 's1', number: 1, say: 'experience', sentence: 'Many graduates lack practical experience.' }] }] }], answerKey: { s1: { accept: ['experience'] } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.test.parts[0]!.questionGroups[0]).toMatchObject({ type: 'dictation', maxPlays: 2, questions: [{ id: 's1', say: 'experience' }] });
    const bad = validateTest({ title: 'S1', skill: 'vocabulary', parts: [{ id: 'p1', title: 'Spelling', questionGroups: [{ id: 'g1', type: 'dictation', questions: [{ id: 's1', number: 1 }] }] }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map(e => e.path)).toEqual(expect.arrayContaining(['parts[0].questionGroups[0].questions[0].say']));
  });

  it('the words stay off the page; each plays at most twice; strict spelling', async () => {
    const testId = await newTest('dictation');
    const id = await start(testId, 'exam');
    const view = await json<AttemptView>(await me.get(`/api/attempts/${id}`));
    expect(JSON.stringify(view.test.content)).not.toMatch(/experience|graduates|environment/);
    const play = () => me.post(`/api/attempts/${id}/dictation/q1/play`, {});
    expect(await json<DictationPlay>(await play())).toEqual({ lines: ['Many graduates lack practical experience.', 'experience'], playsLeft: 1, maxPlays: 2 });
    expect((await json<DictationPlay>(await play())).playsLeft).toBe(0);
    const third = await play();
    expect(third.status).toBe(409);
    expect((await json<{ message: string }>(third)).message).toContain('2 times');
    expect((await json<DictationPlay>(await me.post(`/api/attempts/${id}/dictation/q2/play`, {}))).lines).toEqual(['environment']);
    expect((await me.post(`/api/attempts/${id}/dictation/nope/play`, {})).status).toBe(404);
    // the count cannot be reset by an autosave, and survives a reload
    await me.patch(`/api/attempts/${id}`, { state: { 'dict:q1': 0 }, answers: { q1: 'experiance', q2: 'environment' } });
    expect((await play()).status).toBe(409);
    expect((await json<AttemptView>(await me.get(`/api/attempts/${id}`))).attempt.state['dict:q1']).toBe(2);
    await me.post(`/api/attempts/${id}/submit`, {});
    const r = await json<ResultView>(await me.get(`/api/attempts/${id}/result`));
    expect(r.autoScore.questions.map(q => q.correct)).toEqual([false, true]);
    // after submission the word can be heard again
    expect((await play()).status).toBe(200);
  });
});

describe('plan blocks with a section', () => {
  it('saves review / main / mastery and refuses anything else', async () => {
    await setPlan(srv.database.db, { days: [{ day: 40, date: '2026-12-01', title: 'Day 40', blocks: [
      { id: 'd40b1', title: 'Mistakes review', section: 'review' }, { id: 'd40b2', title: 'Lesson', section: 'main' }, { id: 'd40b3', title: 'W1 drill', section: 'mastery' }, { id: 'd40b4', title: 'Loose' }
    ] }] });
    const t = await json<TodayResponse>(await me.get('/api/plan/today?date=2026-12-01'));
    expect(t.today?.blocks.map(b => b.section ?? null)).toEqual(['review', 'main', 'mastery', null]);
    await expect(setPlan(srv.database.db, { days: [{ day: 41, date: '2026-12-02', title: 'x', blocks: [{ id: 'd41b1', title: 'y', section: 'other' }] }] })).rejects.toThrow(/review, main or mastery/);
  });
});

describe('the mastery step of an auto-submitted exam counts when the results open', () => {
  it('records it once', async () => {
    await upsertSteps(srv.database.db, [{ id: 'r1-tfng', ladder: 'R', order: 1, title: 'R1 TFNG', passRule: { minPercent: 90, inARow: 2 } }]);
    const testId = await newTest('tfng', { masteryStepId: 'r1-tfng', timeLimitMin: 1 });
    const id = await start(testId, 'exam');
    await srv.database.db.update(attempts).set({ startedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(attempts.id, id));
    expect((await me.get(`/api/attempts/${id}/result`)).status).toBe(200);
    await me.get(`/api/attempts/${id}/result`);
    const m = await json<MasteryResponse>(await me.get('/api/mastery'));
    expect(m.ladders.find(l => l.ladder === 'R')!.steps[0]!.attempts).toMatchObject([{ attemptId: id, percent: 0, passed: false }]);
  });
});
