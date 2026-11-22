// Connect to the site the way claude.ai does (register → log in → Allow → code → tokens) and print an access token,
// e.g. for the MCP Inspector:  npx @modelcontextprotocol/inspector --cli <site>/mcp --transport http --header "Authorization: Bearer <token>" --method tools/list
//   node scripts/e2e/mcp-connect.mjs http://localhost:3000            (password: $E2E_PASSWORD, default "ielts-dev")
//   E2E_PASSWORD_FILE=/opt/ielts/stack/initial-password.txt node mcp-connect.mjs https://ielts.jeemdev.net   (on the server)
// The token is valid for one hour. Uses a loopback callback, so nothing is sent to claude.ai.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const site = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const password = process.env.E2E_PASSWORD_FILE ? readFileSync(process.env.E2E_PASSWORD_FILE, 'utf8').trim() : (process.env.E2E_PASSWORD || 'ielts-dev');
const username = process.env.E2E_USERNAME || ''; // once a username is set on the Settings page
const CALLBACK = 'http://localhost:33418/callback';
const jar = {};
const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
const keep = res => { for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar[p.slice(0, i)] = p.slice(i + 1); } return res; };
const fail = msg => { console.error(msg); process.exit(1); };

const reg = await (await fetch(`${site}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Connection check', redirect_uris: [CALLBACK] }) })).json();
if (!reg.client_id) fail(`registration failed: ${JSON.stringify(reg)}`);

keep(await fetch(`${site}/login`, { redirect: 'manual' }));
const login = keep(await fetch(`${site}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': decodeURIComponent(jar.ielts_csrf || ''), origin: site, cookie: cookie() }, body: JSON.stringify({ password, ...(username ? { username } : {}) }) }));
if (!login.ok) fail(`login failed (${login.status})`);

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 's', scope: 'ielts', resource: `${site}/mcp` });
const page = await (keep(await fetch(`${site}/oauth/authorize?${q}`, { headers: { cookie: cookie() }, redirect: 'manual' }))).text();
const fields = Object.fromEntries([...page.matchAll(/name="([a-z_]+)" value="([^"]*)"/g)].map(m => [m[1], m[2].replace(/&amp;/g, '&')]));
if (!fields.csrf) fail('no approval page');
const approved = await fetch(`${site}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: site, cookie: cookie() }, body: new URLSearchParams({ ...fields, decision: 'allow' }) });
const code = new URL(approved.headers.get('location') || CALLBACK).searchParams.get('code');
if (!code) fail(`approval failed (${approved.status} ${approved.headers.get('location')})`);

const tok = await (await fetch(`${site}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: reg.client_id, code_verifier: verifier }) })).json();
if (!tok.access_token) fail(`token exchange failed: ${JSON.stringify(tok)}`);
await fetch(`${site}/api/auth/logout`, { method: 'POST', headers: { 'x-csrf-token': decodeURIComponent(jar.ielts_csrf || ''), origin: site, cookie: cookie() } });
process.stdout.write(tok.access_token);
