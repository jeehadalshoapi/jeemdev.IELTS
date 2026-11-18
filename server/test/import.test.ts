import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  URBAN_BEEKEEPING, type DashboardResponse, type ImportCheckResponse, type ImportSaveResponse, type TestsResponse, type UploadResponse
} from '@ielts/shared';
import { eq } from 'drizzle-orm';
import { files } from '../src/db/schema';
import { FileStore } from '../src/files/store';
import { locate, prepareImport, stripFences } from '../src/import/service';
import { detectType, labeledList, parseTestText } from '../src/import/textformat';
import { getTest } from '../src/tests/repository';
import { Client, startServer, type TestServer } from './helpers';

const TEMPLATES = path.join(import.meta.dirname, '..', '..', 'templates');
const template = (name: string) => readFile(path.join(TEMPLATES, name), 'utf8');
const json = async <T>(r: Response) => (await r.json()) as T;
const fakeFile = (n: number) => `/files/${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

describe('text format', () => {
  it('turns every template into a valid test', async () => {
    for (const [name, skill, parts] of [
      ['example-reading-urban-beekeeping.txt', 'reading', 1], ['reading-template.txt', 'reading', 3],
      ['listening-template.txt', 'listening', 4], ['writing-template.txt', 'writing', 2]
    ] as const) {
      const r = prepareImport(await template(name), {}, { assumeFiles: true });
      expect(r.errors, name).toEqual([]);
      expect(r.format).toBe('text');
      expect(r.summary).toMatchObject({ skill, parts: expect.any(Array) });
      expect(r.summary!.parts).toHaveLength(parts);
    }
  });

  it('matches the old site on the sample test: 17 marks, same answers', async () => {
    const r = prepareImport(await template('example-reading-urban-beekeeping.txt'));
    expect(r.ok).toBe(true);
    expect(r.summary!.marks).toBe(17);
    expect(r.summary!.answers).toBe(17);
    const types = r.summary!.parts[0]!.groups.map(g => g.type);
    expect(types).toContain('tfng');
    expect(types).toContain('matching_headings');
  });

  it('reads KIND, DUE and TIME: none, and fills in standard instructions', () => {
    const r = prepareImport([
      'TITLE: Homework drill', 'MODULE: Reading', 'KIND: Homework', 'DUE: 2026-12-01', 'TIME: none', '',
      '=== PASSAGE 1 ===', 'TEXT:', '[A] Bees like flowers.', '',
      '--- TRUE FALSE NOT GIVEN ---', 'QUESTIONS:', '1. Bees like flowers. | T', '2. Bees hate rain. | ng'
    ].join('\n'));
    expect(r.errors).toEqual([]);
    expect(r.summary).toMatchObject({ kind: 'homework', dueDate: '2026-12-01', timeLimitMin: null, marks: 2 });
    const doc = r.json as { parts: Array<{ questionGroups: Array<{ instructions: string }> }>; answerKey: Record<string, { accept: string[] }> };
    expect(doc.parts[0]!.questionGroups[0]!.instructions).toMatch(/^Do the following statements agree/);
    expect(doc.answerKey).toEqual({ q1: { accept: ['TRUE'] }, q2: { accept: ['NOT GIVEN'] } });
  });

  it('reports every problem at once, with the line and question number', () => {
    const r = prepareImport([
      'TITLE: Broken', 'MODULE: Reading', '',
      '=== PASSAGE 1 ===', 'TEXT:', 'Some text.', '',
      '--- SENTENCE COMPLETION ---', 'INSTRUCTIONS:', 'Write NO MORE THAN TWO WORDS for each answer.', 'TEXT:', 'It is near the [[old railway station]].', '',
      '--- MATCHING ---', 'OPTIONS:', 'A. cheap', 'B. quiet', 'QUESTIONS:', '2. Hotel one | C', '3. Hotel two |', '',
      '--- TRUE FALSE NOT GIVEN ---', 'QUESTIONS:', '4. Statement | MAYBE'
    ].join('\n'));
    expect(r.ok).toBe(false);
    const find = (text: string) => r.errors.find(e => e.message.includes(text));
    expect(find('no accepted answer fits the word limit')).toMatchObject({ path: 'answerKey.q1.accept', where: 'line 8 · Part 1 “Passage 1” › group 1 (SENTENCE COMPLETION) › question 1' });
    expect(find('must be one of the option labels A, B (got "C")')?.where).toContain('question 2');
    expect(find('needs at least one accepted answer')?.where).toContain('line 14');
    expect(find('must be TRUE, FALSE or NOT GIVEN (got "MAYBE")')?.where).toContain('question 4');
  });

  it('asks for the files a test names, and maps them to uploads', async () => {
    const text = await template('listening-template.txt');
    const missing = prepareImport(text);
    expect(missing.ok).toBe(false);
    expect(missing.errors.map(e => e.message)).toEqual(['part1.mp3', 'part2.mp3', 'map.png', 'part3.mp3', 'part4.mp3'].map(n => `the file "${n}" is not attached — add it with "Attach audio / pictures", or remove this line`));
    expect(missing.errors[0]!.where).toBe('line 17');

    const attached = { 'Part1.MP3': fakeFile(1), 'part2.mp3': fakeFile(2), 'map.png': fakeFile(3), 'part3.mp3': fakeFile(4), 'part4.mp3': fakeFile(5), 'extra.png': fakeFile(6) };
    const ok = prepareImport(text, attached);
    expect(ok.errors).toEqual([]);
    expect(ok.fileIds).toHaveLength(5);
    expect(ok.summary!.parts[0]!.audio).toBe(fakeFile(1)); // file names match without regard to case
    expect(ok.warnings.map(w => w.message)).toContain('"extra.png" is attached but the test does not use it');
  });

  it('detects group types and option lists like the old site', () => {
    expect(detectType('TRUE FALSE NOT GIVEN')).toBe('tfng');
    expect(detectType('Choose TWO')).toBe('mcq_multi');
    expect(detectType('Map labelling')).toBe('completion'); // QUESTIONS + OPTIONS then turn it into matching
    expect(labeledList('i. One\nii. Two')).toEqual([{ label: 'i', text: 'One' }, { label: 'ii', text: 'Two' }]);
    expect(labeledList('A\nB\nC').map(o => o.label)).toEqual(['A', 'B', 'C']);
    const t = parseTestText('stray line\nTITLE: x\n=== PART 1 ===');
    expect(t.notes).toContainEqual({ line: 1, message: expect.stringContaining('was ignored') });
  });
});

describe('JSON', () => {
  it('accepts JSON as Claude writes it, also inside a ``` fence', () => {
    const fenced = `Here is the test:\n\`\`\`json\n${JSON.stringify(URBAN_BEEKEEPING)}\n\`\`\`\nGood luck!`;
    expect(stripFences(fenced)).toBe(JSON.stringify(URBAN_BEEKEEPING));
    const r = prepareImport(fenced);
    expect(r).toMatchObject({ format: 'json', ok: true, errors: [], json: null });
    expect(r.summary!.title).toBe(URBAN_BEEKEEPING.title);
  });

  it('says where broken JSON is broken', () => {
    const r = prepareImport('{\n  "title": "X",\n  "parts": [ , ]\n}');
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ path: '(json)', where: expect.stringMatching(/^line 3, column \d+$/), message: expect.stringMatching(/^is not valid JSON: /) });
    expect(prepareImport('[{}]').errors[0]!.message).toContain('paste one test at a time');
  });

  it('maps "audioUrl": "<file name>" to an attached file', () => {
    const doc = structuredClone(URBAN_BEEKEEPING) as unknown as { parts: Array<Record<string, unknown>> };
    doc.parts[0]!.questionGroups = (doc.parts[0]!.questionGroups as Array<Record<string, unknown>>).map((g, i) => (i === 0 ? { ...g, imageUrl: 'hive.png' } : g));
    const without = prepareImport(JSON.stringify(doc));
    expect(without.errors).toEqual([expect.objectContaining({ path: 'parts[0].questionGroups[0].imageUrl', message: expect.stringContaining('"hive.png" is not attached') })]);
    const withFile = prepareImport(JSON.stringify(doc), { 'hive.png': fakeFile(7) });
    expect(withFile.ok).toBe(true);
    expect(withFile.fileIds).toEqual([fakeFile(7).slice(7)]);
  });

  it('describes a path in words', () => {
    expect(locate('parts[0].questionGroups[1].questions[0].text', URBAN_BEEKEEPING)).toMatch(/^Part 1 “.+” › group 2 \(.+\) › question \d+$/);
    expect(locate('answerKey.q1', URBAN_BEEKEEPING)).toContain('question 1');
    expect(locate('title', URBAN_BEEKEEPING)).toBeUndefined();
  });
});

describe('import box API', () => {
  let srv: TestServer;
  let me: Client;
  beforeAll(async () => {
    srv = await startServer();
    me = new Client(srv.url);
    await me.login();
  });
  afterAll(async () => { await srv.close(); });

  const upload = (c: { cookies: Record<string, string> }, name: string, type: string, body: Uint8Array | string) =>
    fetch(`${srv.url}/api/files?name=${encodeURIComponent(name)}`, {
      method: 'POST', body, headers: {
        'content-type': type, origin: srv.url, 'x-csrf-token': c.cookies.ielts_csrf ?? '',
        cookie: Object.entries(c.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ')
      }
    });

  it('needs a login and the CSRF token', async () => {
    const anon = new Client(srv.url);
    await anon.get('/login'); // a CSRF cookie, but no session
    expect((await anon.post('/api/import/check', { source: 'x' })).status).toBe(401);
    expect((await anon.get('/api/tests')).status).toBe(401);
    expect((await upload(anon, 'a.mp3', 'audio/mpeg', 'abc')).status).toBe(401);
    expect((await me.post('/api/import', { source: 'x' }, { 'x-csrf-token': '' })).status).toBe(403);
    expect((await upload({ cookies: { ...me.cookies, ielts_csrf: '' } }, 'a.mp3', 'audio/mpeg', 'abc')).status).toBe(403);
  });

  it('checks without saving, then saves to the dashboard', async () => {
    const source = JSON.stringify({ ...URBAN_BEEKEEPING, title: 'Imported beekeeping' });
    const check = await json<ImportCheckResponse>(await me.post('/api/import/check', { source }));
    expect(check).toMatchObject({ ok: true, format: 'json', errors: [] });
    expect(check.summary?.marks).toBeGreaterThan(0);
    expect('doc' in check).toBe(false);
    expect((await json<TestsResponse>(await me.get('/api/tests'))).tests.some(t => t.title === 'Imported beekeeping')).toBe(false);

    const res = await me.post('/api/import', { source });
    expect(res.status).toBe(201);
    const saved = await json<ImportSaveResponse>(res);
    expect(saved.title).toBe('Imported beekeeping');
    const stored = await getTest(srv.database.db, saved.id);
    expect(stored).toMatchObject({ source: 'manual', status: 'assigned' });
    const dash = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(dash.assigned.map(t => t.id)).toContain(saved.id);

    // the same title again: allowed, with a warning
    const again = await json<ImportCheckResponse>(await me.post('/api/import/check', { source }));
    expect(again.warnings[0]).toMatchObject({ path: 'title', message: expect.stringContaining('is already saved') });
  });

  it('refuses to save an invalid test and lists every problem', async () => {
    const res = await me.post('/api/import', { source: '{ "title": "", "skill": "cooking", "parts": [] }' });
    expect(res.status).toBe(400);
    const body = await json<{ error: string; issues: Array<{ path: string }> }>(res);
    expect(body.error).toBe('invalid_test');
    expect(body.issues.map(i => i.path)).toEqual(expect.arrayContaining(['title', 'skill', 'parts']));
    expect((await me.post('/api/import/check', { source: '   ' })).status).toBe(400);
  });

  it('uploads audio and pictures, and links them to the imported test', async () => {
    const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x44, 1, 2, 3]);
    const up = await upload(me, 'part1.mp3', 'audio/mpeg', bytes);
    expect(up.status).toBe(201);
    const file = await json<UploadResponse>(up);
    expect(file).toMatchObject({ name: 'part1.mp3', kind: 'audio', sizeBytes: 7, url: `/files/${file.id}` });

    // served back behind the login
    const served = await me.get(file.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(bytes);
    expect((await new Client(srv.url).get(file.url)).status).toBe(401);

    const source = [
      'TITLE: Listening with a recording', 'MODULE: Listening', 'TIME: 10', '',
      '=== PART 1 ===', 'AUDIO: part1.mp3', '', '--- SHORT ANSWER ---', 'QUESTIONS:', '1. Where? | (the) station',
      '', '=== PART 2 ===', '', '--- SHORT ANSWER ---', 'QUESTIONS:', '2. When? | Monday'
    ].join('\n');
    const res = await me.post('/api/import', { source, files: { 'part1.mp3': file.url } });
    expect(res.status).toBe(201);
    const { id } = await json<ImportSaveResponse>(res);
    const [row] = await srv.database.db.select().from(files).where(eq(files.id, file.id));
    expect(row?.testId).toBe(id);
    const test = await getTest(srv.database.db, id);
    expect(test!.document.parts[0]!.audioUrl).toBe(file.url);
    expect(test!.document.parts[1]!.audioUrl).toBeUndefined(); // part 2 plays on from part 1's recording
  });

  it('serves files even when UPLOAD_DIR is relative or inside a dot-folder', () => {
    const store = new FileStore(srv.database.db, path.join('.data', 'uploads'));
    expect(path.isAbsolute(store.rootDir)).toBe(true);
  });

  it('refuses other file types, empty files and files over the limit', async () => {
    expect((await upload(me, 'x.svg', 'image/svg+xml', '<svg/>')).status).toBe(415);
    expect((await upload(me, 'x.html', 'text/html', '<p>')).status).toBe(415);
    expect((await upload(me, 'empty.png', 'image/png', new Uint8Array())).status).toBe(400);
    const big = await upload(me, 'big.png', 'image/png', new Uint8Array(10 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect((await json<{ message: string }>(big)).message).toContain('larger than 10 MB');
    expect((await me.post('/api/files', {})).status).toBe(400); // no ?name=
  });

  it('archives and restores a test (never deletes it)', async () => {
    const { tests } = await json<TestsResponse>(await me.get('/api/tests'));
    const t = tests[0]!;
    const res = await me.patch(`/api/tests/${t.id}`, { status: 'archived' });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ id: t.id, status: 'archived' });
    expect((await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.map(a => a.id)).not.toContain(t.id);
    expect((await json<TestsResponse>(await me.get('/api/tests'))).tests.find(x => x.id === t.id)?.status).toBe('archived');
    expect((await me.patch(`/api/tests/${t.id}`, { status: 'assigned' })).status).toBe(200);
    expect((await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.map(a => a.id)).toContain(t.id);
    expect((await me.patch(`/api/tests/${t.id}`, { status: 'deleted' })).status).toBe(400);
    expect((await me.patch('/api/tests/00000000-0000-4000-8000-000000000000', { status: 'archived' })).status).toBe(404);
  });
});
