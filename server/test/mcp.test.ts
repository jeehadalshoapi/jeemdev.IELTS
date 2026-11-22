import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleTestForType, URBAN_BEEKEEPING, type ConnectorResponse, type DashboardResponse, type ResultView } from '@ielts/shared';
import { loadConfig } from '../src/config';
import { tokenVerifier } from '../src/mcp/oauth';
import { applyChanges } from '../src/mcp/tools';
import { SAMPLE_TEST_ID, seedSample } from '../src/seed';
import { getTest } from '../src/tests/repository';
import { Client, startServer, type TestServer } from './helpers';

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
let srv: TestServer;
let me: Client;

beforeAll(async () => {
  srv = await startServer();
  await seedSample(srv.database.db);
  me = new Client(srv.url);
  await me.login();
});
afterAll(async () => { await srv.close(); });

const json = async <T = Record<string, unknown>>(r: Response) => (await r.json()) as T;
const cookieHeader = (c: Client) => Object.entries(c.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');

/** a browser form post (the approval page) */
const postForm = (c: Client, path: string, data: Record<string, string>, origin = srv.url) => fetch(srv.url + path, {
  method: 'POST', redirect: 'manual', body: new URLSearchParams(data),
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie: cookieHeader(c) }
});
/** what claude.ai's servers send to the token endpoint */
const tokenRequest = (data: Record<string, string>) => fetch(`${srv.url}/oauth/token`, {
  method: 'POST', body: new URLSearchParams(data), headers: { 'content-type': 'application/x-www-form-urlencoded' }
});

async function register(redirect = CALLBACK) {
  const r = await fetch(`${srv.url}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' }) });
  return { status: r.status, body: await json<{ client_id: string; token_endpoint_auth_method: string; error?: string }>(r) };
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

const authorizeQuery = (clientId: string, challenge: string, extra: Record<string, string> = {}) => new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256',
  state: 'st-123', scope: 'ielts', resource: `${srv.url}/mcp`, ...extra
}).toString();

/** the whole connection dance: register, owner approves, code -> tokens */
async function connect(): Promise<{ clientId: string; access: string; refresh: string }> {
  const { body: client } = await register();
  const { verifier, challenge } = pkce();
  const page = await me.get(`/oauth/authorize?${authorizeQuery(client.client_id, challenge)}`);
  const html = await page.text();
  const fields = Object.fromEntries([...html.matchAll(/name="([a-z_]+)" value="([^"]*)"/g)].map(m => [m[1]!, m[2]!.replace(/&amp;/g, '&')]));
  const approved = await postForm(me, '/oauth/authorize', { ...fields, decision: 'allow' });
  const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
  const t = await json<{ access_token: string; refresh_token: string }>(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier }));
  return { clientId: client.client_id, access: t.access_token, refresh: t.refresh_token };
}

/** one JSON-RPC call to /mcp, the way a 2025-11-25 client (claude.ai) sends it */
async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
  const r = await fetch(`${srv.url}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const text = await r.text();
  const payload = (r.headers.get('content-type') ?? '').includes('event-stream')
    ? text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))).find(m => m.id === 1)
    : text ? JSON.parse(text) : null;
  return { status: r.status, headers: r.headers, body: payload as { result?: Record<string, unknown>; error?: { message: string } } };
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  const result = r.body.result as { content: Array<{ text: string }>; isError?: boolean };
  const text = result.content[0]!.text;
  let data: Record<string, unknown> | null = null;
  try { data = JSON.parse(text); } catch { /* a message */ }
  return { isError: !!result.isError, text, data: data as Record<string, any> };
}

describe('discovery (what claude.ai reads first)', () => {
  it('refuses /mcp without a token, pointing at the metadata', async () => {
    const r = await fetch(`${srv.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain(`resource_metadata="${srv.url}/.well-known/oauth-protected-resource/mcp"`);
    const bad = await rpc('at_not-a-real-token', 'tools/list');
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain('invalid_token');
  });

  it('publishes protected-resource and authorization-server metadata', async () => {
    for (const p of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const prm = await json(await fetch(srv.url + p));
      expect(prm).toMatchObject({ resource: `${srv.url}/mcp`, authorization_servers: [srv.url], scopes_supported: ['ielts'] });
    }
    const as = await json(await fetch(`${srv.url}/.well-known/oauth-authorization-server`));
    expect(as).toMatchObject({
      issuer: srv.url, authorization_endpoint: `${srv.url}/oauth/authorize`, token_endpoint: `${srv.url}/oauth/token`,
      registration_endpoint: `${srv.url}/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none']
    });
    const pre = await fetch(`${srv.url}/oauth/token`, { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('OAuth', () => {
  it('registers Claude as a public client, and refuses other callbacks', async () => {
    const ok = await register();
    expect(ok.status).toBe(201);
    expect(ok.body.token_endpoint_auth_method).toBe('none');
    expect((await register('http://localhost:6274/oauth/callback')).status).toBe(201); // MCP Inspector
    const evil = await register('https://evil.example/callback');
    expect(evil.status).toBe(400);
    expect(evil.body.error).toBe('invalid_redirect_uri');
  });

  it('needs the owner to log in and press Allow', async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    const q = authorizeQuery(client.client_id, challenge);
    // not logged in: off to the login page, which comes back here afterwards
    const anon = await new Client(srv.url).get(`/oauth/authorize?${q}`);
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe(`/login?next=${encodeURIComponent(`/oauth/authorize?${q}`)}`);
    const back = await me.get(`/login?next=${encodeURIComponent(`/oauth/authorize?${q}`)}`);
    expect(back.headers.get('location')).toBe(`/oauth/authorize?${q}`);
    expect((await me.get('/login?next=https://evil.example')).headers.get('location')).toBe('/');

    // logged in: the approval page; its form may lead to claude.ai
    const page = await me.get(`/oauth/authorize?${q}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Allow Claude to use your IELTS site?');
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self' https://claude.ai");

    // unknown client / unregistered callback: an error page, no redirect
    expect((await me.get(`/oauth/authorize?${authorizeQuery('client_nope', challenge)}`)).status).toBe(400);
    expect((await me.get(`/oauth/authorize?${authorizeQuery(client.client_id, challenge, { redirect_uri: 'https://claude.ai/elsewhere' })}`)).status).toBe(400);
    // no PKCE: the error goes back to the app
    const noPkce = await me.get(`/oauth/authorize?${authorizeQuery(client.client_id, '', { code_challenge_method: 'plain' })}`);
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
  });

  it('refuses an approval without the CSRF token, and reports Cancel as access_denied', async () => {
    const { body: client } = await register();
    const { challenge } = pkce();
    const fields = Object.fromEntries(new URLSearchParams(authorizeQuery(client.client_id, challenge)));
    expect((await postForm(me, '/oauth/authorize', { ...fields, decision: 'allow', csrf: 'forged' })).status).toBe(400);
    expect((await postForm(me, '/oauth/authorize', { ...fields, decision: 'allow', csrf: me.cookies.ielts_csrf! }, 'https://evil.example')).status).toBe(400);
    // browsers send "Origin: null" under the site's no-referrer policy; the CSRF token still protects the form
    const viaNull = await postForm(me, '/oauth/authorize', { ...fields, decision: 'allow', csrf: me.cookies.ielts_csrf! }, 'null');
    expect(new URL(viaNull.headers.get('location')!).searchParams.get('code')).toBeTruthy();
    const denied = await postForm(me, '/oauth/authorize', { ...fields, decision: 'deny', csrf: me.cookies.ielts_csrf! });
    const loc = new URL(denied.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(CALLBACK);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('st-123');
  });

  it('gives tokens for a code once, only with the right PKCE verifier', async () => {
    const { body: client } = await register();
    const { verifier, challenge } = pkce();
    const page = await (await me.get(`/oauth/authorize?${authorizeQuery(client.client_id, challenge)}`)).text();
    const fields = Object.fromEntries([...page.matchAll(/name="([a-z_]+)" value="([^"]*)"/g)].map(m => [m[1]!, m[2]!.replace(/&amp;/g, '&')]));
    const approved = await postForm(me, '/oauth/authorize', { ...fields, decision: 'allow' });
    const loc = new URL(approved.headers.get('location')!);
    expect(loc.searchParams.get('state')).toBe('st-123');
    expect(loc.searchParams.get('iss')).toBe(srv.url);
    const code = loc.searchParams.get('code')!;
    const wrong = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: pkce().verifier });
    expect(wrong.status).toBe(400);
    // the failed attempt used the code up
    const late = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: client.client_id, code_verifier: verifier });
    expect((await json(late)).error).toBe('invalid_grant');
  });

  it('rotates refresh tokens; an old one stops working', async () => {
    const t = await connect();
    expect((await rpc(t.access, 'tools/list')).status).toBe(200);
    const r1 = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.clientId });
    expect(r1.status).toBe(200);
    const n1 = await json<{ access_token: string; refresh_token: string }>(r1);
    expect(n1.refresh_token).not.toBe(t.refresh);
    expect((await rpc(t.access, 'tools/list')).status).toBe(401); // the old access token ended with the rotation
    expect((await rpc(n1.access_token, 'tools/list')).status).toBe(200);
    const again = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: t.clientId });
    expect((await json(again)).error).toBe('invalid_grant');
    expect((await rpc(n1.access_token, 'tools/list')).status).toBe(200); // a quick retry does not end the connection
  });

  it('a changed password ends every connection', async () => {
    const t = await connect();
    const config = await loadConfig({ adminPasswordHash: 'scrypt:16384:8:1:aaaa:bbbb' });
    await expect(tokenVerifier(srv.database.db, config).verifyAccessToken(t.access)).rejects.toThrow(/invalid, expired or revoked/);
  });

  it('the website lists the connection and can disconnect it', async () => {
    const t = await connect();
    const c = await json<ConnectorResponse>(await me.get('/api/connector'));
    expect(c.mcpUrl).toBe(`${srv.url}/mcp`);
    expect(c.connections.length).toBeGreaterThan(0);
    expect(c.connections[0]!.clientName).toBe('Claude');
    expect((await me.post('/api/connector/disconnect')).status).toBe(200);
    expect((await rpc(t.access, 'tools/list')).status).toBe(401);
    expect((await json<ConnectorResponse>(await me.get('/api/connector'))).connections).toEqual([]);
    expect((await new Client(srv.url).get('/api/connector')).status).toBe(401); // login required
  });
});

describe('tools', () => {
  let token: string;
  beforeAll(async () => { token = (await connect()).access; });

  it('lists the tools: the eleven of spec §6 and the study tools of Phase 8', async () => {
    const r = await rpc(token, 'tools/list');
    const names = ((r.body.result as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> }).tools).map(t => t.name).sort();
    expect(names).toEqual(expect.arrayContaining(['archive_test', 'create_test', 'get_attempt', 'get_latest_attempt', 'get_progress', 'get_test', 'get_test_format', 'list_attempts', 'list_tests', 'save_feedback', 'update_test',
      'create_lesson', 'update_lesson', 'get_lesson', 'list_lessons', 'upsert_vocab_set', 'list_vocab_sets', 'get_vocab_set', 'record_vocab_result', 'update_word',
      'add_mistakes', 'list_mistakes', 'update_mistake']));
  });

  it('get_test_format: rules, one example per type, a full example', async () => {
    const r = await callTool(token, 'get_test_format', { types: ['tfng', 'note_completion'] });
    expect(r.isError).toBe(false);
    expect(Object.keys(r.data.questionTypes)).toEqual(['tfng', 'note_completion']);
    expect(r.data.rules.length).toBeGreaterThan(5);
    expect(r.data.completeExample.title).toBe(URBAN_BEEKEEPING.title);
    expect((await callTool(token, 'get_test_format', { jsonSchema: true })).data.jsonSchema.type).toBe('object');
  });

  let createdId = '';
  it('create_test: saves a valid test, lists every problem of an invalid one', async () => {
    const bad = await callTool(token, 'create_test', { test: { title: 'Broken', skill: 'reading', parts: [] } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Nothing was saved');
    expect(bad.text).toContain('parts: needs at least one part');

    const r = await callTool(token, 'create_test', { test: { ...URBAN_BEEKEEPING, title: 'From Claude', kind: 'homework', dueDate: '2026-12-01' } });
    expect(r.isError).toBe(false);
    createdId = r.data.id;
    expect(r.data.url).toBe(`${srv.url}/#/test/${createdId}`);
    expect(r.data.summary.questions).toBeGreaterThan(0);
    expect((await getTest(srv.database.db, createdId))?.source).toBe('claude');
    // the text format works too
    const txt = await callTool(token, 'create_test', { test: 'TITLE: Text drill\nMODULE: Reading\n=== PASSAGE 1 ===\nTEXT:\nBees.\n--- TRUE FALSE NOT GIVEN ---\nQUESTIONS:\n1. Bees. | T' });
    expect(txt.isError).toBe(false);
  });

  it('list_tests, get_test (with the answer key), archive_test', async () => {
    const list = await callTool(token, 'list_tests', { kind: 'homework' });
    expect(list.data.tests.map((t: { id: string }) => t.id)).toContain(createdId);
    const one = await callTool(token, 'get_test', { id: createdId });
    expect(one.data.test.answerKey).toEqual(URBAN_BEEKEEPING.answerKey);
    expect((await callTool(token, 'get_test', { id: '00000000-0000-4000-8000-000000000000' })).isError).toBe(true);
  });

  let attemptId = '';
  it('get_latest_attempt / get_attempt: each answer, the right answer and the reason', async () => {
    expect((await callTool(token, 'get_latest_attempt')).text).toContain('No submitted attempt yet');
    const { id } = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, { mode: 'practice' }));
    attemptId = id;
    const view = await json<{ test: { content: { parts: Array<{ questionGroups: Array<{ type: string; questions?: Array<{ id: string }> }> }> } } }>(await me.get(`/api/attempts/${id}`));
    const tf = view.test.content.parts[0]!.questionGroups.find(g => g.type === 'tfng')!.questions![0]!.id;
    await me.post(`/api/attempts/${id}/submit`, { answers: { [tf]: 'NOT GIVEN' } });

    const latest = await callTool(token, 'get_latest_attempt', { skill: 'reading' });
    expect(latest.isError).toBe(false);
    expect(latest.data.id).toBe(id);
    const q = latest.data.questions.find((x: { id: string }) => x.id === tf);
    expect(q).toMatchObject({ yourAnswer: 'NOT GIVEN', result: expect.stringMatching(/correct|wrong/) });
    expect(q.question.length).toBeGreaterThan(5);
    expect(latest.data.score.total).toBeGreaterThan(0);
    expect(latest.data.resultsUrl).toBe(`${srv.url}/#/result/${id}`);
    expect((await callTool(token, 'get_attempt', { id })).data.id).toBe(id);
    expect((await callTool(token, 'list_attempts', { status: 'submitted' })).data.attempts[0].id).toBe(id);
    expect((await callTool(token, 'get_attempt', { id: 'nope' })).isError).toBe(true); // schema: not a uuid
  });

  it('save_feedback: the attempt becomes marked and the results page shows it', async () => {
    const bad = await rpc(token, 'tools/call', { name: 'save_feedback', arguments: { attemptId, feedback: { overallBand: 6.3, summary: 'x' } } });
    const badResult = bad.body.result as { isError?: boolean; content: Array<{ text: string }> } | undefined;
    expect(badResult?.isError ?? !!bad.body.error).toBe(true);

    const r = await callTool(token, 'save_feedback', { attemptId, feedback: { overallBand: 6.5, summary: 'Good **skimming**.', mistakes: [{ questionId: 'q999', explanation: 'x' }], nextSteps: ['Practise NOT GIVEN'] } });
    expect(r.isError).toBe(false);
    expect(r.data.warning).toContain('q999');
    const result = await json<ResultView>(await me.get(`/api/attempts/${attemptId}/result`));
    expect(result.attempt.status).toBe('marked');
    expect(result.feedback).toMatchObject({ overallBand: 6.5, summary: 'Good **skimming**.', nextSteps: ['Practise NOT GIVEN'] });
    expect((await callTool(token, 'list_attempts', { status: 'marked' })).data.attempts[0].feedbackSaved).toBe(true);
  });

  it('update_test: fixes the key and re-scores submitted attempts', async () => {
    const before = await callTool(token, 'get_attempt', { id: attemptId });
    const tfq = before.data.questions.find((x: { yourAnswer: string | null }) => x.yourAnswer === 'NOT GIVEN');
    const r = await callTool(token, 'update_test', { id: SAMPLE_TEST_ID, changes: { answerKey: { [tfq.id]: { accept: ['NOT GIVEN'] } } } });
    expect(r.isError).toBe(false);
    expect(r.data.rescoredAttempts).toBe(1);
    const after = await callTool(token, 'get_attempt', { id: attemptId });
    expect(after.data.questions.find((x: { id: string }) => x.id === tfq.id).result).toBe('correct');
    const invalid = await callTool(token, 'update_test', { id: SAMPLE_TEST_ID, changes: { skill: 'cooking' } });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain('Nothing was changed');
    expect((await callTool(token, 'update_test', { id: SAMPLE_TEST_ID })).text).toContain('exactly one of');
  });

  it('get_progress and archive_test', async () => {
    const p = await callTool(token, 'get_progress', { skill: 'reading' });
    expect(p.data.attempts).toBe(1);
    expect(p.data.bySkill.reading.attempts).toBe(1);
    expect(p.data.byQuestionType.length).toBeGreaterThan(0);
    const a = await callTool(token, 'archive_test', { id: createdId });
    expect(a.data).toEqual({ id: createdId, status: 'archived' });
    expect((await getTest(srv.database.db, createdId))?.status).toBe('archived');
  });

  it('applyChanges: merges the answer key per question, null removes', () => {
    const doc = { title: 'T', answerKey: { q1: { accept: ['A'] }, q2: { accept: ['B'] } }, dueDate: '2026-01-01' } as never;
    expect(applyChanges(doc, { answerKey: { q1: { accept: ['C'] }, q2: null }, dueDate: null, title: 'New' }))
      .toEqual({ title: 'New', answerKey: { q1: { accept: ['C'] } } });
  });
});

describe('study tools (Phase 8): lessons, vocabulary, mistakes log', () => {
  let token: string;
  beforeAll(async () => { token = (await connect()).access; });

  const LESSON = {
    id: 'day23-band-6-7-8', day: 23, week: 'writing', title: 'What separates band 6, 7 and 8', skill: 'writing', summary: 'One line',
    sections: [
      { heading: 'The one-line difference', markdown: 'Band 7 **answers the exact question**.' },
      { heading: 'Band descriptors', table: { header: ['', 'Band 6', 'Band 7'], rows: [['Task Response', 'relevant', 'clear position']] } },
      { examples: [{ label: 'Band 6', text: 'Some people think…', notes: ['vague'] }] },
      { tip: 'Underline the question words.' }
    ],
    relatedTestIds: [SAMPLE_TEST_ID], vocabularySetIds: ['set-3']
  };

  it('lessons: create, refuse a duplicate and an invalid one with paths, update, get, list; the website shows them', async () => {
    const c = await callTool(token, 'create_lesson', { lesson: LESSON });
    expect(c.isError).toBe(false);
    expect(c.data).toMatchObject({ saved: true, id: LESSON.id, sections: 4 });
    expect(c.data.url).toContain('#/lesson/day23-band-6-7-8');
    expect((await callTool(token, 'create_lesson', { lesson: LESSON })).text).toContain('already exists');
    const bad = await callTool(token, 'create_lesson', { lesson: { id: 'bad id!', title: '', sections: [{}], kind: 'other' } });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('- id:');
    expect(bad.text).toContain('- sections[0]:');
    expect(bad.text).toContain('- kind:');

    const u = await callTool(token, 'update_lesson', { id: LESSON.id, changes: { summary: 'Better line', week: null } });
    expect(u.isError).toBe(false);
    const g = await callTool(token, 'get_lesson', { id: LESSON.id });
    expect(g.data.lesson).toMatchObject({ summary: 'Better line', kind: 'lesson' });
    expect(g.data.lesson.week).toBeUndefined();
    expect(g.data.tests[0]).toMatchObject({ id: SAMPLE_TEST_ID });
    await callTool(token, 'create_lesson', { lesson: { id: 'tfng-rules', kind: 'reference', title: 'T/F/NG rules', skill: 'reading', sections: [{ markdown: 'NOT GIVEN = no information.' }] } });
    expect((await callTool(token, 'list_lessons', { kind: 'reference' })).data.lessons.map((l: { id: string }) => l.id)).toEqual(['tfng-rules']);
    expect((await callTool(token, 'list_lessons', { day: 23 })).data.lessons).toHaveLength(1);

    const list = await json<Array<{ id: string }>>(await me.get('/api/lessons'));
    expect(list.map(l => l.id).sort()).toEqual(['day23-band-6-7-8', 'tfng-rules']);
    expect((await me.get('/api/lessons/nope')).status).toBe(404);
  });

  it('vocabulary: save a set, keep word statuses when it is replaced, record a self-test (weak words), update a word', async () => {
    const set = { id: 'set-3', number: 3, theme: 'Good and bad effects', studyDay: 23, words: [
      { word: 'mitigate', pos: 'v', arabic: 'يخفف', meaning: 'make less severe', opposite: 'aggravate' },
      { word: 'alleviate', pos: 'v', meaning: 'ease pain' }, { word: 'exacerbate', pos: 'v' }] };
    expect((await callTool(token, 'upsert_vocab_set', { set })).data).toMatchObject({ id: 'set-3', created: true, words: 3 });
    expect((await callTool(token, 'upsert_vocab_set', { set: { ...set, words: [...set.words, { word: 'Mitigate' }] } })).text).toContain('"Mitigate" is already words[0]');

    const r = await callTool(token, 'record_vocab_result', { result: { setId: 'set-3', quiz: 1, date: '2026-11-17', score: 1, total: 3, weakWords: ['MITIGATE', 'zzz'] } });
    expect(r.data.weakMarked).toEqual(['mitigate']);
    expect(r.data.warning).toContain('zzz');
    await callTool(token, 'update_word', { setId: 'set-3', word: 'alleviate', status: 'learned', example: 'Aspirin alleviates pain.' });
    // replacing the set keeps statuses of the words that stay, drops the others
    await callTool(token, 'upsert_vocab_set', { set: { ...set, words: set.words.slice(0, 2) } });
    const g = await callTool(token, 'get_vocab_set', { id: 'set-3' });
    expect(g.data.set.words.map((w: { word: string; status: string; timesMissed: number }) => [w.word, w.status, w.timesMissed])).toEqual([['mitigate', 'weak', 1], ['alleviate', 'learned', 0]]);
    expect(g.data.results[0]).toMatchObject({ score: 1, total: 3, weakWords: ['MITIGATE', 'zzz'] });
    expect((await callTool(token, 'list_vocab_sets')).data.sets[0]).toMatchObject({ id: 'set-3', words: 2, byStatus: { weak: 1, learned: 1, new: 0, learning: 0 } });
    expect((await callTool(token, 'update_word', { setId: 'set-3', word: 'nothing' })).text).toContain('is not in set');

    // the website: the owner marks a word
    expect((await me.patch('/api/vocab/sets/set-3/words', { word: 'mitigate', status: 'learning' })).status).toBe(200);
    const v = await json<{ set: { words: Array<{ status: string }> } }>(await me.get('/api/vocab/sets/set-3'));
    expect(v.set.words[0]!.status).toBe('learning');
    expect((await me.patch('/api/vocab/sets/set-3/words', { word: 'mitigate', status: 'forgotten' })).status).toBe(400);
  });

  it('mistakes log: bulk add with dedupe, never again at 2, list, update; the daily review masters after 3 days', async () => {
    const a = await callTool(token, 'add_mistakes', { mistakes: [
      { category: 'spelling', wrong: 'experiance', correct: 'experience', rule: 'experi-ence' },
      { category: 'reading_trap', wrong: 'most', correct: 'many', rule: 'many ≠ most' },
      { category: 'spelling', wrong: 'goverment', correct: 'government', timesWrong: 3 },
      { category: 'spelling', wrong: 'Experiance ', correct: 'experience' }
    ] });
    expect(a.data).toMatchObject({ added: 3, repeated: 1 });
    expect(a.data.repeatedEntries[0]).toMatchObject({ wrong: 'experiance', timesWrong: 2, neverAgain: true });
    const bad = await callTool(token, 'add_mistakes', { mistakes: [{ category: 'spelling', wrong: 'x', correct: 'y' }, { category: 'typo', wrong: '', correct: 'z' }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('mistakes[1].category');
    expect(bad.text).toContain('mistakes[1].wrong');
    const l = await callTool(token, 'list_mistakes', { neverAgain: true });
    expect(l.data.mistakes.map((m: { wrong: string }) => m.wrong)).toEqual(['goverment', 'experiance']);
    expect((await callTool(token, 'list_mistakes', { category: 'reading_trap' })).data.mistakes).toHaveLength(1);
    const id = l.data.mistakes[1].id as string;
    expect((await callTool(token, 'update_mistake', { id, changes: { rule: 'experi-ENCE, like science' } })).data.mistake.rule).toBe('experi-ENCE, like science');

    // review: right on 3 different days = mastered; twice on one day counts once; wrong resets
    const review = (correct: boolean, today: string) => me.post(`/api/mistakes/${id}/review`, { correct, today });
    expect((await json<{ streak: number }>(await review(true, '2026-11-18'))).streak).toBe(1);
    expect((await json<{ streak: number }>(await review(true, '2026-11-18'))).streak).toBe(1);
    expect((await json<{ streak: number }>(await review(false, '2026-11-19'))).streak).toBe(0);
    for (const d of ['2026-11-20', '2026-11-21']) await review(true, d);
    const done = await json<{ streak: number; status: string }>(await review(true, '2026-11-22'));
    expect(done).toMatchObject({ streak: 3, status: 'mastered' });
    // the same mistake made again: active again, counted again
    const again = await callTool(token, 'add_mistakes', { mistakes: [{ category: 'spelling', wrong: 'experiance', correct: 'experience' }] });
    expect(again.data.repeatedEntries[0]).toMatchObject({ timesWrong: 3 });
    const rows = await json<Array<{ id: string; status: string; streak: number }>>(await me.get('/api/mistakes?category=spelling'));
    expect(rows.find(m => m.id === id)).toMatchObject({ status: 'active', streak: 0 });
    expect((await me.get('/api/mistakes?category=nope')).status).toBe(400);
  });

  it('save_feedback with addToLog files the mistakes once, even when saved again', async () => {
    const att = await json<{ id: string }>(await me.post(`/api/tests/${SAMPLE_TEST_ID}/attempts`, { mode: 'practice' }));
    await me.post(`/api/attempts/${att.id}/submit`, { answers: { q12: 'permits' } });
    const feedback = { summary: 'ok', mistakes: [
      { questionId: 'q12', yourAnswer: 'permits', correct: 'permit', explanation: 'singular in the key', category: 'Spelling', addToLog: true },
      { yourAnswer: 'the', correct: 'The', explanation: 'sentence start', category: 'capital', addToLog: true, rule: 'Capital at the start' },
      { yourAnswer: 'x', explanation: 'no correct form', category: 'grammar', addToLog: true },
      { explanation: 'not for the log', category: 'timing' }
    ] };
    const s1 = await callTool(token, 'save_feedback', { attemptId: att.id, feedback });
    expect(s1.data.mistakesLog).toMatchObject({ added: 2, repeated: 0, alreadyLogged: 0 });
    expect(s1.data.mistakesLog.skipped).toEqual([{ index: 2, reason: 'needs both yourAnswer and correct' }]);
    const s2 = await callTool(token, 'save_feedback', { attemptId: att.id, feedback });
    expect(s2.data.mistakesLog).toMatchObject({ added: 0, repeated: 0, alreadyLogged: 2 });
    const caps = (await callTool(token, 'list_mistakes', { category: 'capitals' })).data.mistakes;
    expect(caps[0]).toMatchObject({ wrong: 'the', correct: 'The', rule: 'Capital at the start', timesWrong: 1 });
    expect(caps[0].source.attemptId).toBe(att.id);
  });
});

describe('plan and picture tools (Phase 10)', () => {
  let token: string;
  beforeAll(async () => { token = (await connect()).access; });

  it('upload_asset: saves a cleaned SVG, served only to the logged-in owner with a sandbox CSP', async () => {
    const r = await callTool(token, 'upload_asset', { name: 'Campus map', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" onclick="x()"><rect width="200" height="100" fill="#f1efe9"/><text x="20" y="40">A</text><script>alert(1)</script></svg>' });
    expect(r.isError).toBe(false);
    expect(r.data.url).toMatch(/^\/files\/[0-9a-f-]{36}$/);
    expect(r.data.removed).toEqual(expect.arrayContaining(['<script>', 'event handlers (on…)']));
    const f = await me.get(r.data.url);
    expect(f.status).toBe(200);
    expect(f.headers.get('content-type')).toContain('image/svg+xml');
    expect(f.headers.get('content-security-policy')).toContain('sandbox');
    const body = await f.text();
    expect(body).toContain('<text x="20" y="40">A</text>');
    expect(body).not.toContain('script');
    expect((await fetch(srv.url + r.data.url)).status).toBe(401);
    // a test can use it
    const t = await callTool(token, 'create_test', { test: { title: 'Map', skill: 'listening', parts: [{ id: 'p1', title: 'Part 2', transcript: 'Guide: The library is A.', questionGroups: [{ id: 'g1', type: 'map_labelling', imageUrl: r.data.url, options: [{ label: 'A' }, { label: 'B' }], questions: [{ id: 'q1', number: 1, text: 'Library' }] }] }], answerKey: { q1: { accept: ['A'] } } } });
    expect(t.isError).toBe(false);
    expect((await callTool(token, 'upload_asset', { svg: '<svg><g></svg>  not closed  ' })).text).toContain('not saved');
  });

  it('set_plan, get_plan, update_block', async () => {
    const s = await callTool(token, 'set_plan', { days: [{ day: 30, date: '2026-11-24', title: 'Listening week starts', blocks: [{ id: 'd30b1', title: 'Maps' }] }] });
    expect(s.data).toMatchObject({ saved: 1, deleted: 0 });
    const bad = await callTool(token, 'set_plan', { days: [{ day: 31, date: 'soon', title: '', blocks: [{ id: 'x', title: 'a' }, { id: 'x', title: 'b' }] }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('days[0].date');
    expect(bad.text).toContain('block id "x" is already used');
    expect((await callTool(token, 'update_block', { id: 'd30b1', status: 'done' })).data.block.status).toBe('done');
    expect((await callTool(token, 'get_plan', { fromDay: 30 })).data.days[0].blocks[0].status).toBe('done');
    expect((await callTool(token, 'update_block', { id: 'nope', status: 'done' })).text).toContain('no plan block');
  });
  it('mastery: steps, a linked writing test, two passes in a row unlock the next step, recheck', async () => {
    const up = await callTool(token, 'upsert_mastery_step', { steps: [
      { id: 'w1-introduction', ladder: 'W', ladderTitle: 'Writing, one part at a time', order: 1, title: 'W1 Introduction', task: '5-min plan + 2-sentence introduction', passRule: { minBand: 7, inARow: 2 } },
      { id: 'w2-body', ladder: 'W', order: 2, title: 'W2 Body paragraph', passRule: { minBand: 7, inARow: 2 } }
    ] });
    expect(up.isError).toBe(false);
    expect(up.data.created).toEqual(['w1-introduction', 'w2-body']);
    expect(up.data.steps.map((x: { status: string }) => x.status)).toEqual(['active', 'locked']);
    const bad = await callTool(token, 'upsert_mastery_step', { steps: [{ id: 'x y', ladder: 'W', order: 'one', title: '', passRule: { minBand: 7.3 } }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('- [0].id');
    expect(bad.text).toContain('- [0].order');

    const t = await callTool(token, 'create_test', { test: { ...exampleTestForType('writing_task2'), title: 'W1 drill', masteryStepId: 'w1-introduction' } });
    expect(t.isError).toBe(false);
    expect(t.data.warnings).toEqual([]);
    const noStep = await callTool(token, 'create_test', { test: { ...exampleTestForType('writing_task2'), title: 'Orphan', masteryStepId: 'w9-nothing' } });
    expect(noStep.data.warnings.join(' ')).toContain('no mastery step "w9-nothing"');

    const attemptWith = async (band: number) => {
      const { id } = await json<{ id: string }>(await me.post(`/api/tests/${t.data.id}/attempts`, { mode: 'practice' }));
      expect((await me.post(`/api/attempts/${id}/submit`, {})).status).toBe(200);
      const f = await callTool(token, 'save_feedback', { attemptId: id, feedback: { overallBand: band, summary: 'ok' } });
      expect(f.isError).toBe(false);
      return f.data;
    };
    expect((await attemptWith(6.5)).mastery).toMatchObject({ stepId: 'w1-introduction', counted: { band: 6.5, passed: false }, stepStatus: 'active' });
    expect((await attemptWith(7)).mastery.stepStatus).toBe('active');
    expect((await attemptWith(7.5)).mastery.stepStatus).toBe('passed');
    const list = await callTool(token, 'list_mastery', { ladder: 'W' });
    expect(list.data.ladders[0]).toMatchObject({ ladder: 'W', ladderTitle: 'Writing, one part at a time', current: 'w2-body' });
    expect(list.data.ladders[0].steps[0]).toMatchObject({ status: 'passed', passesInARow: 2 }); expect(list.data.ladders[0].steps[0].attempts).toHaveLength(3);
    expect(list.data.ladders[0].steps[0].newestTest).toMatchObject({ id: t.data.id });
    // the test stays on the dashboard until the step is passed; then it is on the Done page
    expect((await json<DashboardResponse>(await me.get('/api/dashboard'))).assigned.map(x => x.id)).not.toContain(t.data.id);

    expect((await callTool(token, 'update_mastery_step', { id: 'w1-introduction', status: 'recheck' })).data.step.status).toBe('recheck');
    const dash = await json<DashboardResponse>(await me.get('/api/dashboard'));
    expect(dash.assigned.find(x => x.id === t.data.id)?.mastery).toMatchObject({ stepId: 'w1-introduction', status: 'recheck' });
    expect((await attemptWith(6)).mastery.stepStatus).toBe('recheck');
    expect((await attemptWith(7)).mastery.stepStatus).toBe('passed');
    const g = await callTool(token, 'get_mastery_step', { id: 'w1-introduction' });
    expect(g.data.attempts).toHaveLength(5);
    expect(g.data.passRuleText).toBe('band 7+ twice in a row');
    // the re-check does not take the next step back
    expect((await callTool(token, 'get_mastery_step', { id: 'w2-body' })).data.status).toBe('active');
    expect((await callTool(token, 'get_mastery_step', { id: 'nope' })).text).toContain('no mastery step');
    expect((await callTool(token, 'update_mastery_step', { id: 'w2-body' })).isError).toBe(true);
  });
  it('mastery: 31 tools; a new step counts attempts submitted before it existed; update with "changes"', async () => {
    const list = await rpc(token, 'tools/list');
    const names = ((list.body.result as { tools: Array<{ name: string }> }).tools).map(t => t.name);
    expect(names).toEqual(expect.arrayContaining(['upsert_mastery_step', 'list_mastery', 'get_mastery_step', 'update_mastery_step']));
    expect(names).toHaveLength(31);

    const t = await callTool(token, 'create_test', { test: { ...exampleTestForType('tfng'), title: 'R1 early', masteryStepId: 'r1-word-box' } });
    expect(t.data.warnings.join(' ')).toContain('no mastery step "r1-word-box"');
    for (const ans of ['TRUE', 'TRUE', 'FALSE']) {
      const { id } = await json<{ id: string }>(await me.post(`/api/tests/${t.data.id}/attempts`, { mode: 'practice' }));
      await me.post(`/api/attempts/${id}/submit`, { answers: { q1: ans } });
    }
    const key = (await callTool(token, 'get_test', { id: t.data.id })).data.test.answerKey.q1.accept[0];
    const up = await callTool(token, 'upsert_mastery_step', { steps: [
      { id: 'r1-word-box', ladder: 'R', ladderTitle: 'Reading precision', order: 1, title: 'R1 Word box', task: '8-gap summary', lessonId: 'ref-reading', passRule: { minPercent: 85, inARow: 2 } },
      { id: 'r2-tfng', ladder: 'R', order: 2, title: 'R2 T/F/NG', passRule: { minPercent: 85, inARow: 2 } }
    ] });
    expect(up.data.backfilledAttempts).toBe(3);
    const passes = ['TRUE', 'TRUE', 'FALSE'].map(a => a === key);
    const r = (await callTool(token, 'list_mastery', { ladder: 'R' })).data.ladders[0];
    expect(r.steps[0].attempts.map((x: { passed: boolean }) => x.passed)).toEqual(passes);
    expect(r.steps[0]).toMatchObject({ task: '8-gap summary', passRule: { minPercent: 85, inARow: 2 }, newestTest: { id: t.data.id, url: expect.stringContaining(`#/test/${t.data.id}`) } });
    expect(r.steps[0].status).toBe(passes[0] && passes[1] ? 'passed' : 'active');
    // a test made now gets no warning
    expect((await callTool(token, 'create_test', { test: { ...exampleTestForType('tfng'), title: 'R1 #2', masteryStepId: 'r1-word-box' } })).data.warnings).toEqual([]);

    const u = await callTool(token, 'update_mastery_step', { id: 'r2-tfng', changes: { task: '8 statements', lessonId: 'ref-reading', passRule: { minPercent: 80, inARow: 3 } } });
    expect(u.isError).toBe(false);
    expect(u.data.step).toMatchObject({ task: '8 statements', lessonId: 'ref-reading', passRule: { minPercent: 80, inARow: 3 } });
    expect((await callTool(token, 'update_mastery_step', { id: 'r2-tfng', changes: { passRule: { minBand: 7.3 } } })).isError).toBe(true);
    expect((await callTool(token, 'get_mastery_step', { id: 'r1-word-box' })).data.tests[0].url).toContain('#/test/');
  });
});
