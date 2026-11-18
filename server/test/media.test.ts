import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, type AttemptView, type RecordingInfo, type ResultView, type SpeechResponse } from '@ielts/shared';
import { eq } from 'drizzle-orm';
import { files } from '../src/db/schema';
import { attemptDetail } from '../src/mcp/attempts';
import { createTest } from '../src/tests/repository';
import { Client, startServer, type TestServer } from './helpers';

let srv: TestServer;
let me: Client;
let speakingTest: string, listeningTest: string, writingTest: string;

beforeAll(async () => {
  srv = await startServer();
  me = new Client(srv.url);
  await me.login();
  const db = srv.database.db;
  // Part 1 + Part 2 (with a follow-up) in one speaking test
  const p1 = exampleTestForType('speaking_part1'), p2 = exampleTestForType('speaking_part2');
  speakingTest = (await createTest(db, { ...p1, title: 'Speaking', parts: [{ ...(p1.parts[0] as object), questionGroups: [...(p1.parts[0]!.questionGroups as object[]), ...(p2.parts[0]!.questionGroups as object[])] } as never] }, { source: 'claude' })).id;
  const l = exampleTestForType('form_completion');
  listeningTest = (await createTest(db, {
    ...l, title: 'Read-aloud listening',
    parts: [{ ...(l.parts[0] as object), transcript: 'Narrator: Part one.\nWoman: Hello, my name is Sarah Mitchell.\nMan: And your phone number?' } as never]
  }, { source: 'claude' })).id;
  writingTest = (await createTest(db, exampleTestForType('writing_task1'), { source: 'claude' })).id;
});
afterAll(async () => { await srv.close(); });

const json = async <T>(r: Response) => (await r.json()) as T;
const start = async (testId: string, mode: 'exam' | 'practice' = 'practice') => (await json<{ id: string }>(await me.post(`/api/tests/${testId}/attempts`, { mode }))).id;
const upload = (path: string, body: Uint8Array, type = 'audio/webm;codecs=opus') => fetch(srv.url + path, {
  method: 'POST', body, headers: { 'content-type': type, origin: srv.url, 'x-csrf-token': me.cookies.ielts_csrf!, cookie: Object.entries(me.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') }
});
const audio = (n: number) => new Uint8Array(n).fill(7);

describe('speaking recordings', () => {
  it('saves one recording per speaking question, replacing the earlier one', async () => {
    const id = await start(speakingTest);
    const first = await upload(`/api/attempts/${id}/recordings?item=s1q1&duration=12.4`, audio(500));
    expect(first.status).toBe(201);
    const r1 = await json<RecordingInfo>(first);
    expect(r1).toMatchObject({ mimeType: 'audio/webm', sizeBytes: 500, durationSec: 12, url: `/files/${r1.id}` });
    const [row1] = await srv.database.db.select().from(files).where(eq(files.id, r1.id));
    expect(row1).toMatchObject({ kind: 'recording', attemptId: id, itemId: 's1q1' });

    const r2 = await json<RecordingInfo>(await upload(`/api/attempts/${id}/recordings?item=s1q1&duration=20`, audio(800)));
    expect((await srv.database.db.select().from(files).where(eq(files.id, r1.id))).length).toBe(0); // the old one is gone
    expect(existsSync(srv.fileStore.absolutePath(row1!.storagePath))).toBe(false);
    await upload(`/api/attempts/${id}/recordings?item=s2&duration=118`, audio(900), 'audio/mp4');

    const view = await json<AttemptView>(await me.get(`/api/attempts/${id}`));
    expect(Object.keys(view.recordings).sort()).toEqual(['s1q1', 's2']);
    expect(view.recordings.s1q1!.id).toBe(r2.id);
    const served = await me.get(r2.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('audio/webm');

    // delete one
    expect((await me.request('DELETE', `/api/attempts/${id}/recordings/s1q1`)).status).toBe(200);
    expect(Object.keys((await json<AttemptView>(await me.get(`/api/attempts/${id}`))).recordings)).toEqual(['s2']);

    // what Claude sees after submission: the transcript text, the recording link, Part 2 notes
    await me.patch(`/api/attempts/${id}`, { answers: { s2: 'I often go to Hyde Park.' }, state: { 'prep:s2': 'where: London; why: quiet' } });
    await me.post(`/api/attempts/${id}/submit`, {});
    const result = await json<ResultView>(await me.get(`/api/attempts/${id}/result`));
    expect(result.recordings.s2?.durationSec).toBe(118);
    const detail = await attemptDetail(srv.database.db, id, srv.url) as { writingAndSpeaking: Array<Record<string, unknown>>; speakingNote: string };
    const s2 = detail.writingAndSpeaking.find(o => o.id === 's2')!;
    expect(s2).toMatchObject({ answer: 'I often go to Hyde Park.', preparationNotes: 'where: London; why: quiet', recording: { url: `${srv.url}/files/${result.recordings.s2!.id}`, durationSec: 118 } });
    expect(s2.task).toContain('Describe a park');
    expect(detail.speakingNote).toContain('mark from the text');

    // and nothing changes once it is submitted
    expect((await upload(`/api/attempts/${id}/recordings?item=s1q2`, audio(10))).status).toBe(409);
  });

  it('refuses other items, other types, empty bodies, and visitors', async () => {
    const id = await start(speakingTest);
    expect((await upload(`/api/attempts/${id}/recordings?item=q1`, audio(10))).status).toBe(400);
    expect((await upload(`/api/attempts/${id}/recordings?item=s1q1`, audio(10), 'image/png')).status).toBe(415);
    expect((await upload(`/api/attempts/${id}/recordings?item=s1q1`, new Uint8Array())).status).toBe(400);
    const anon = new Client(srv.url);
    await anon.get('/login');
    expect((await anon.post(`/api/attempts/${id}/recordings?item=s1q1`, {})).status).toBe(401);
  });
});

describe('listening read aloud', () => {
  it('practice: every line, from the start; the transcript is not in the attempt view', async () => {
    const id = await start(listeningTest);
    const view = await json<AttemptView>(await me.get(`/api/attempts/${id}`));
    expect(view.test.content.parts[0]!.transcript).toBeUndefined();
    const s = await json<SpeechResponse>(await me.get(`/api/attempts/${id}/speech/${view.test.content.parts[0]!.id}`));
    expect(s).toMatchObject({ from: 0, total: 3 });
    expect(s.lines[1]).toEqual({ speaker: 'Woman', text: 'Hello, my name is Sarah Mitchell.' });
  });

  it('exam: only the lines not heard yet (each part plays once)', async () => {
    const id = await start(listeningTest, 'exam');
    const partId = (await json<AttemptView>(await me.get(`/api/attempts/${id}`))).test.content.parts[0]!.id;
    await me.patch(`/api/attempts/${id}`, { state: { [`tts:${partId}`]: { line: 2 } } });
    const s = await json<SpeechResponse>(await me.get(`/api/attempts/${id}/speech/${partId}`));
    expect(s).toMatchObject({ from: 2, total: 3, lines: [{ speaker: 'Man', text: 'And your phone number?' }] });
    await me.patch(`/api/attempts/${id}`, { state: { [`tts:${partId}`]: { line: 3 } } });
    expect((await json<SpeechResponse>(await me.get(`/api/attempts/${id}/speech/${partId}`))).lines).toEqual([]);
  });

  it('nothing to read for a part with a recording, or a part that does not exist; login required', async () => {
    const id = await start(writingTest);
    expect((await me.get(`/api/attempts/${id}/speech/p1`)).status).toBe(404);
    expect((await new Client(srv.url).get(`/api/attempts/${id}/speech/p1`)).status).toBe(401);
  });
});

describe('writing task 1 for Claude', () => {
  it('get_attempt includes the chart data of the task', async () => {
    const id = await start(writingTest);
    await me.post(`/api/attempts/${id}/submit`, { answers: { w1: 'The chart shows temperatures.' } });
    const detail = await attemptDetail(srv.database.db, id, srv.url) as { writingAndSpeaking: Array<{ charts?: Array<{ chartType: string }> }> };
    expect(detail.writingAndSpeaking[0]!.charts?.[0]?.chartType).toBeTruthy();
  });
});
