// Logged-in smoke check of a running site, for after a deploy. Run it ON the box (the password never leaves it):
//   E2E_PASSWORD_FILE=/opt/ielts/stack/initial-password.txt node prod-check.mjs https://ielts.jeemdev.net [/api/extra/path ...]
// Prints only status codes and counts, never the password or answers.
import { readFileSync } from 'node:fs';

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const extra = process.argv.slice(3);
const password = process.env.E2E_PASSWORD_FILE ? readFileSync(process.env.E2E_PASSWORD_FILE, 'utf8').trim() : process.env.E2E_PASSWORD || 'ielts-dev';
const username = process.env.E2E_USERNAME || ''; // once a username is set on the Settings page
const jar = new Map();
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, opts = {}) {
  const r = await fetch(base + path, {
    method: opts.method || 'GET', redirect: 'manual',
    headers: { cookie: cookie(), origin: base, 'x-csrf-token': jar.get('ielts_csrf') || '', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  return r;
}
const show = async (path, summarize) => {
  const r = await call(path);
  let note = '';
  if (r.ok && summarize) { try { note = summarize(await r.json()); } catch { note = '(not JSON)'; } }
  console.log(`${r.status} ${path}${note ? `  ${note}` : ''}`);
  return r.ok;
};

let ok = true;
console.log(`${(await call('/api/dashboard')).status} /api/dashboard without login (expect 401/403)`);
await call('/login');
const login = await call('/api/auth/login', { method: 'POST', body: { password, ...(username ? { username } : {}) } });
console.log(`${login.status} login`);
ok &&= login.ok;
ok &&= await show('/api/dashboard', d => `to do ${d.assigned?.length ?? '?'}, in progress ${d.inProgress?.length ?? '?'}, done ${d.doneCount ?? '?'}`);
ok &&= await show('/api/done', d => `done tests ${d.tests?.length ?? '?'}, results ${d.completed?.length ?? '?'}`);
ok &&= await show('/api/mastery', m => `ladders ${m.ladders?.length ?? '?'}`);
ok &&= await show('/api/history', h => `attempts ${h.attempts.length}, skills ${Object.keys(h.bySkill).join('/') || '-'}, types ${h.byType.length}, Claude categories ${h.feedbackMistakes?.length ?? 'MISSING'}`);
ok &&= await show('/api/history?skill=reading&since=2026-01-01', h => `attempts ${h.attempts.length}`);
const bad = await call('/api/history?skill=maths');
console.log(`${bad.status} /api/history?skill=maths (expect 400)`);
ok &&= bad.status === 400;
const h = await (await call('/api/history')).json();
const marked = h.attempts.find(a => a.feedbackReady);
if (marked) ok &&= await show(`/api/attempts/${marked.id}/result`, r => `feedback keys: ${Object.keys(r.feedback ?? {}).join(',')}`);
for (const p of extra) ok &&= await show(p, d => (Array.isArray(d) ? `${d.length} items` : Object.keys(d).slice(0, 8).join(',')));
console.log(ok ? 'ALL OK' : 'SOMETHING FAILED');
process.exit(ok ? 0 : 1);
