import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, URBAN_BEEKEEPING, type AttemptView, type DashboardResponse, type DoneResponse, type SaveResult } from '@ielts/shared';
import { eq, sql } from 'drizzle-orm';
import { attempts } from '../src/db/schema';
import { SAMPLE_TEST_ID, seedSample } from '../src/seed';
import { createTest } from '../src/tests/repository';
import { Client, PASSWORD, startServer, type TestServer } from './helpers';

let srv: TestServer;
let me: Client;
let listeningId: string;

beforeAll(async () => {
  srv = await startServer();
  await seedSample(srv.database.db);
  listeningId = (await createTest(srv.database.db, { ...exampleTestForType('form_completion'), timeLimitMin: 30 }, { source: 'claude' })).id;
  me = new Client(srv.url);
});
afterAll(async () => { await srv.close(); });

const json = async <T>(r: Response) => (await r.json()) as T;

describe('login', () => {
  it('health check is public', async () => {
    const r = await fetch(`${srv.url}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, db: 'up' });
  });

  it('refuses the site and the API without login', async () => {
    const anon = new Client(srv.url);
    const home = await anon.get('/');
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('/login');
    expect((await anon.get('/api/dashboard')).status).toBe(401);
    expect((await anon.get(`/api/tests/${SAMPLE_TEST_ID}`)).status).toBe(401);
    expect((await anon.get('/login')).status).toBe(200);
  });

  it('needs the CSRF token and a same-site origin', async () => {
    const c = new Client(srv.url);
    await c.get('/login');
    expect((await c.post('/api/auth/login', { password: 'x' }, { 'x-csrf-token': '' })).status).toBe(403);
    const evil = new Client(srv.url, 'https://evil.example');
    await evil.get('/login');
    const r = await evil.post('/api/auth/login', { password: PASSWORD });
    expect(r.status).toBe(403);
    expect((await json<{ error: string }>(r)).error).toBe('bad_origin');
  });

  it('rejects a wrong password and accepts the right one with an httpOnly session cookie', async () => {
    const c = new Client(srv.url);
    expect((await c.login('wrong password')).status).toBe(401);
    await c.get('/login');
    const r = await c.post('/api/auth/login', { password: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.headers.getSetCookie().find(s => s.startsWith('ielts_session='))).toMatch(/HttpOnly/);
    expect((await c.get('/')).status).toBe(200);
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/dashboard')).status).toBe(401);
  });

  it('locks out password guessing after 10 wrong passwords (only failures count)', async () => {
    const own = await startServer(); // separate server: the lockout is per server and per IP
    try {
      const c = new Client(own.url);
      expect((await c.login()).status).toBe(200);
      expect((await c.login()).status).toBe(200); // successful logins never count
      await c.get('/login');
      const codes: number[] = [];
      for (let i = 0; i < 11; i++) codes.push((await c.post('/api/auth/login', { password: `guess ${i}` })).status);
      expect(codes.slice(0, 10).every(s => s === 401)).toBe(true);
      expect(codes[10]).toBe(429);
      expect((await c.post('/api/auth/login', { password: PASSWORD })).status).toBe(429); // even the right one, until it expires
    } finally {
      await own.close();
    }
  }, 30000);
});

describe('tests and attempts', () => {
  beforeAll(async () => { expect((await me.login()).status).toBe(200); });

  it('dashboard lists assigned tests', async () => {
    const d = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(d.assigned.map(t => t.title)).toContain(URBAN_BEEKEEPING.title);
    expect(d.assigned.find(t => t.id === SAMPLE_TEST_ID)).toMatchObject({ marks: 17, timeLimitMin: 20, inProgressAttemptId: null });
  });

  it('never sends the answer key or the transcript before submission', async () => {
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${listeningId}/attempts`, { mode: 'practice' }));
    const raw = await (await me.get(`/api/attempts/${id}`)).text();
    expect(raw).not.toMatch(/answerKey|"accept"|transcript|Mitchell/);
    const detail = await (await me.get(`/api/tests/${SAMPLE_TEST_ID}`)).text();
    expect(detail).not.toMatch(/answerKey|"accept"|colony collapse disorder"\]/);
  });

  it('merges saves from two devices and resumes on either', async () => {
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, { mode: 'practice', device: 'phone' }));
    const phone = await me.patch(`/api/attempts/${id}`, { answers: { q1: 'iii', q6: 'TRUE' }, state: { pos: { partId: 'p1', number: 6 } }, device: 'phone' });
    expect(phone.status).toBe(200);
    const laptop = await me.patch(`/api/attempts/${id}`, { answers: { q11: 'register', q15: ['A', 'C'] }, device: 'laptop' });
    expect(laptop.status).toBe(200);
    await me.patch(`/api/attempts/${id}`, { answers: { q6: null }, device: 'laptop' });

    const view = await json<AttemptView>(await me.get(`/api/attempts/${id}`));
    expect(view.attempt.answers).toEqual({ q1: 'iii', q6: null, q11: 'register', q15: ['A', 'C'] });
    expect(view.attempt.state.pos).toEqual({ partId: 'p1', number: 6 });
    const [row] = await srv.database.db.select().from(attempts).where(eq(attempts.id, id));
    expect((row?.deviceLog as Array<{ id: string }>).map(d => d.id).sort()).toEqual(['laptop', 'phone']);

    const d = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(d.inProgress.find(a => a.id === id)).toMatchObject({ answered: 4, items: 17 }); // q15 is "choose TWO": 2 marks
    expect(d.assigned.find(t => t.id === SAMPLE_TEST_ID)?.inProgressAttemptId).toBe(id);
  });

  it('rejects answers for questions that do not exist', async () => {
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, {}));
    const r = await me.patch(`/api/attempts/${id}`, { answers: { q99: 'x', q15: 'A' } });
    expect(r.status).toBe(400);
    const body = await json<{ issues: Array<{ path: string; message: string }> }>(r);
    expect(body.issues).toEqual([
      { path: 'answers.q99', message: 'no question with this id in the test' },
      { path: 'answers.q15', message: 'wrong kind of answer for a mcq_multi question' }
    ]);
  });

  it('practice mode counts only active time, capped by real time', async () => {
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, { mode: 'practice' }));
    const r = await json<SaveResult>(await me.patch(`/api/attempts/${id}`, { activeSec: { p1: 3000 } }));
    expect(r.timing.spentSec.total).toBeLessThanOrEqual(7);
    expect(r.timing.remainingSec).toBeGreaterThan(20 * 60 - 8);
    expect(r.timing.deadline).toBeNull();
  });

  it('exam mode runs on the wall clock, even while closed', async () => {
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, { mode: 'exam' }));
    // pretend the attempt started 5 minutes ago and the browser was closed since
    await srv.database.db.update(attempts).set({ startedAt: sql`now() - interval '5 minutes'` }).where(eq(attempts.id, id));
    const v = await json<AttemptView>(await me.get(`/api/attempts/${id}`));
    expect(v.timing.remainingSec).toBeGreaterThan(15 * 60 - 3);
    expect(v.timing.remainingSec).toBeLessThanOrEqual(15 * 60);
    expect(v.attempt.status).toBe('in_progress');
  });

  it('submits an exam automatically when time ran out, and refuses later answers', async () => {
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, { mode: 'exam' }));
    await me.patch(`/api/attempts/${id}`, { answers: { q1: 'iii' } });
    await srv.database.db.update(attempts).set({ startedAt: sql`now() - interval '25 minutes'` }).where(eq(attempts.id, id));
    const v = await json<AttemptView>(await me.get(`/api/attempts/${id}`));
    expect(v.attempt.status).toBe('submitted');
    expect(v.attempt.autoSubmitted).toBe(true);
    expect(v.attempt.answers).toEqual({ q1: 'iii' });
    expect(new Date(v.attempt.submittedAt!).getTime()).toBe(new Date(v.timing.deadline!).getTime());
    const late = await me.patch(`/api/attempts/${id}`, { answers: { q2: 'i' } });
    expect(late.status).toBe(409);
    expect((await json<{ error: string }>(late)).error).toBe('time_up');
  });

  it('submit finishes the attempt', async () => {
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, { mode: 'practice' }));
    const r = await json<SaveResult>(await me.post(`/api/attempts/${id}/submit`, { answers: { q17: 'colony collapse disorder' } }));
    expect(r.status).toBe('submitted');
    expect((await me.patch(`/api/attempts/${id}`, { answers: { q1: 'i' } })).status).toBe(409);
    const d = await json<DoneResponse>(await me.get('/api/done'));
    expect(d.completed.map(a => a.id)).toContain(id);
  });

  it('serves uploaded files only after login, with range requests for audio', async () => {
    const data = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256));
    const { id } = await srv.fileStore.save({ data, originalName: 'part1.mp3', mimeType: 'audio/mpeg', kind: 'audio' });
    expect((await new Client(srv.url).get(`/files/${id}`)).status).toBe(401);
    const full = await me.get(`/files/${id}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('audio/mpeg');
    const part = await me.request('GET', `/files/${id}`, undefined, { range: 'bytes=10-19' });
    expect(part.status).toBe(206);
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });
});
