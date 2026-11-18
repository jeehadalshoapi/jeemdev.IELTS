import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, type RecordingInfo } from '@ielts/shared';
import { eq } from 'drizzle-orm';
import { files } from '../src/db/schema';
import { textOf, Transcriber } from '../src/files/transcribe';
import { attemptDetail } from '../src/mcp/attempts';
import { createTest } from '../src/tests/repository';
import { Client, startServer, type TestServer } from './helpers';

let srv: TestServer;
let me: Client;
let speakingTest: string;
/** a stand-in for the whisper.cpp server: answers like it does, or fails when the file name says so */
let fake: Server;
let fakeUrl = '';
const seen: Array<{ type: string; length: number }> = [];

beforeAll(async () => {
  srv = await startServer();
  me = new Client(srv.url);
  await me.login();
  speakingTest = (await createTest(srv.database.db, exampleTestForType('speaking_part1'), { source: 'claude' })).id;
  fake = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      seen.push({ type: req.headers['content-type'] ?? '', length: body.length });
      if (req.url !== '/inference' || !/name="file"/.test(body) || !/name="response_format"\r\n\r\njson/.test(body)) { res.writeHead(400).end('bad'); return; }
      if (body.includes('FAIL')) { res.writeHead(500).end('boom'); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: '  I usually walk to work,\n because it is   close.' }));
    });
  });
  await new Promise<void>(r => fake.listen(0, '127.0.0.1', () => r()));
  fakeUrl = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
});
afterAll(async () => { await srv.close(); fake.close(); });

const json = async <T>(r: Response) => (await r.json()) as T;
const upload = (path: string, body: Uint8Array) => fetch(srv.url + path, {
  method: 'POST', body, headers: { 'content-type': 'audio/webm', origin: srv.url, 'x-csrf-token': me.cookies.ielts_csrf!, cookie: Object.entries(me.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') }
});

describe('speaking: fluency figures and transcripts (Phase 11)', () => {
  it('keeps the pauses and speaking time measured by the browser, and gives Claude words per minute', async () => {
    const id = (await json<{ id: string }>(await me.post(`/api/tests/${speakingTest}/attempts`, { mode: 'practice' }))).id;
    const r = await json<RecordingInfo>(await upload(`/api/attempts/${id}/recordings?item=s1q1&duration=40&pauses=2&longestPause=4.6&speaking=30`, new Uint8Array(300).fill(1)));
    expect(r).toMatchObject({ durationSec: 40, pausesOver3s: 2, longestPauseSec: 4.6, speakingSec: 30, transcript: null });
    await me.patch(`/api/attempts/${id}`, { answers: { s1q1: 'I usually walk to work because it is close and I like the fresh air in the morning' } });
    await me.post(`/api/attempts/${id}/submit`, {});
    const d = await attemptDetail(srv.database.db, id, srv.url) as { writingAndSpeaking: Array<{ id: string; recording?: Record<string, unknown> }>; speakingNote: string };
    expect(d.writingAndSpeaking.find(o => o.id === 's1q1')!.recording).toMatchObject({ durationSec: 40, pausesOver3s: 2, longestPauseSec: 4.6, speakingSec: 30, wordsPerMinute: 36 });
    expect(d.speakingNote).toContain('pausesOver3s');
    // nonsense numbers are kept in range or dropped
    const id2 = (await json<{ id: string }>(await me.post(`/api/tests/${speakingTest}/attempts`, { mode: 'practice' }))).id;
    const r2 = await json<RecordingInfo>(await upload(`/api/attempts/${id2}/recordings?item=s1q1&pauses=abc&longestPause=-5&speaking=99999`, new Uint8Array(10).fill(1)));
    expect(r2).toMatchObject({ pausesOver3s: null, longestPauseSec: 0, speakingSec: 3600 });
  });

  it('sends recordings to the speech-to-text server one by one and stores the text (or "failed")', async () => {
    const id = (await json<{ id: string }>(await me.post(`/api/tests/${speakingTest}/attempts`, { mode: 'practice' }))).id;
    const ok = await json<RecordingInfo>(await upload(`/api/attempts/${id}/recordings?item=s1q1&duration=5`, new Uint8Array(200).fill(2)));
    const bad = await json<RecordingInfo>(await upload(`/api/attempts/${id}/recordings?item=s1q2&duration=5`, new TextEncoder().encode('FAIL-FAIL-FAIL')));
    const t = new Transcriber(srv.database.db, srv.fileStore, fakeUrl);
    t.enqueue(ok.id);
    t.enqueue(bad.id);
    t.enqueue(ok.id); // already queued: once
    await t.idle();
    const [a] = await srv.database.db.select().from(files).where(eq(files.id, ok.id));
    const [b] = await srv.database.db.select().from(files).where(eq(files.id, bad.id));
    expect(a).toMatchObject({ transcript: 'I usually walk to work, because it is close.', transcriptStatus: 'done' });
    expect(b).toMatchObject({ transcript: null, transcriptStatus: 'failed' });
    expect(seen.filter(s => s.type.startsWith('multipart/form-data'))).toHaveLength(2);
    const view = await json<{ recordings: Record<string, RecordingInfo> }>(await me.get(`/api/attempts/${id}`));
    expect(view.recordings.s1q1!.transcript).toBe('I usually walk to work, because it is close.');

    // a recording saved while the server was off is picked up on start
    await srv.database.db.update(files).set({ transcript: null, transcriptStatus: null }).where(eq(files.id, ok.id));
    const t2 = new Transcriber(srv.database.db, srv.fileStore, fakeUrl);
    await t2.resumePending();
    await t2.idle();
    expect((await srv.database.db.select().from(files).where(eq(files.id, ok.id)))[0]!.transcriptStatus).toBe('done');
  });

  it('reads the text from the shapes the server may answer with', () => {
    expect(textOf({ text: ' a  b ' })).toBe('a b');
    expect(textOf({ segments: [{ text: 'one' }, { text: ' two' }] })).toBe('one two');
    expect(textOf(' plain text ')).toBe('plain text');
    expect(textOf({ nothing: 1 })).toBeNull();
  });
});
