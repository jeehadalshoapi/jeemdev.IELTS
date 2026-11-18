/*
 * A small OAuth 2.1 authorization server for the Claude connector (spec §6 "Auth"). Single user:
 * an app may connect only after the owner, logged in to the site, presses "Allow" on the approval page.
 *
 * What claude.ai needs (checked against its connector docs, Nov 2026):
 *  - 401 + WWW-Authenticate with resource_metadata on /mcp (done by requireBearerAuth in ./index.ts)
 *  - RFC 9728 protected-resource metadata whose "resource" is exactly <origin>/mcp
 *  - RFC 8414 authorization-server metadata, PKCE S256, dynamic client registration (RFC 7591, public clients)
 *  - a token endpoint that takes application/x-www-form-urlencoded, refresh tokens rotated on use
 *  - callback https://claude.ai/api/mcp/auth_callback (loopback callbacks are allowed for MCP Inspector / Claude Code)
 * Tokens are random strings; only their SHA-256 is stored. Changing the site password ends every connection.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { and, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import type { AppConfig } from '../config';
import type { Db } from '../db/client';
import { oauthClients, oauthTokens } from '../db/schema';
import { CSRF_COOKIE, parseCookies, rateLimit, setCookie } from '../http/security';

export const SCOPE = 'ielts';
const ACCESS_TTL_SEC = 60 * 60;
const REFRESH_TTL_SEC = 60 * 24 * 3600;
const CODE_TTL_MS = 5 * 60_000;
/** a refresh token used twice within this window is a retry, not a theft: refuse it, but keep the connection */
const REFRESH_RETRY_GRACE_MS = 60_000;
const MAX_CLIENTS = 100;

/** the hosted Claude apps' callback (claude.ai web, desktop, mobile) */
export const CLAUDE_CALLBACKS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'];

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const newSecret = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
export const passwordTag = (passwordHash: string) => sha256hex(`ielts-connector:${passwordHash}`).slice(0, 16);

export const originOf = (req: Request, config: AppConfig) => config.publicOrigin ?? `${req.protocol}://${req.get('host')}`;
export const mcpUrlOf = (origin: string) => `${origin}/mcp`;

function safeUrl(s: string): URL | null {
  try { return new URL(s); } catch { return null; }
}
const isLoopback = (u: URL) => u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);

/** redirect URIs this server ever accepts: Claude's callback, or a loopback address on this computer */
export function isAllowedRedirect(uri: string): boolean {
  if (CLAUDE_CALLBACKS.includes(uri)) return true;
  const u = safeUrl(uri);
  return !!u && isLoopback(u) && !u.username && !u.password && !u.hash;
}

/** exact match; loopback addresses match on any port (RFC 8252 §7.3) */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  const u = safeUrl(uri);
  if (!u || !isLoopback(u)) return false;
  return registered.some(r => {
    const v = safeUrl(r);
    return !!v && isLoopback(v) && v.hostname === u.hostname && v.pathname === u.pathname && v.search === u.search;
  });
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/* ---------- authorization codes: short-lived, single use, kept in memory ---------- */
interface PendingCode { clientId: string; clientName: string | null; redirectUri: string; challenge: string; scope: string; resource: string; expiresAt: number }
const codes = new Map<string, PendingCode>();
setInterval(() => { const now = Date.now(); for (const [k, v] of codes) if (v.expiresAt < now) codes.delete(k); }, 60_000).unref();

/* ---------- token checks for /mcp ---------- */
export function tokenVerifier(db: Db, config: AppConfig): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const [row] = await db.select().from(oauthTokens).where(and(eq(oauthTokens.tokenHash, sha256hex(token)), eq(oauthTokens.kind, 'access'))).limit(1);
      const now = new Date();
      if (!row || row.revokedAt || row.expiresAt <= now || row.passwordTag !== passwordTag(config.adminPasswordHash)) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'The access token is invalid, expired or revoked.');
      }
      if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
        void db.update(oauthTokens).set({ lastUsedAt: now }).where(eq(oauthTokens.id, row.id)).catch(() => {});
      }
      return { token, clientId: row.clientId, scopes: row.scope.split(' '), expiresAt: Math.floor(row.expiresAt.getTime() / 1000), resource: new URL(row.resource) };
    }
  };
}

/* ---------- connections overview / disconnect (for the website) ---------- */
export interface Connection { clientId: string; clientName: string | null; connectedAt: string; lastUsedAt: string | null; expiresAt: string }

export async function listConnections(db: Db, config: AppConfig): Promise<Connection[]> {
  const rows = await db.select().from(oauthTokens)
    .where(and(eq(oauthTokens.kind, 'refresh'), isNull(oauthTokens.revokedAt), eq(oauthTokens.passwordTag, passwordTag(config.adminPasswordHash)), sql`${oauthTokens.expiresAt} > now()`));
  const lastUse = await db.select({ familyId: oauthTokens.familyId, first: sql<string>`min(${oauthTokens.createdAt})`, last: sql<string | null>`max(${oauthTokens.lastUsedAt})` })
    .from(oauthTokens).groupBy(oauthTokens.familyId);
  const byFamily = new Map(lastUse.map(r => [r.familyId, r]));
  const iso = (v: string | Date | null | undefined) => (v ? new Date(v).toISOString() : null);
  return rows.map(r => ({
    clientId: r.clientId, clientName: r.clientName,
    connectedAt: iso(byFamily.get(r.familyId)?.first) ?? r.createdAt.toISOString(),
    lastUsedAt: iso(byFamily.get(r.familyId)?.last),
    expiresAt: r.expiresAt.toISOString()
  })).sort((a, b) => (b.lastUsedAt ?? b.connectedAt).localeCompare(a.lastUsedAt ?? a.connectedAt));
}

/** end every connection (Claude has to sign in again) */
export async function revokeAllConnections(db: Db): Promise<number> {
  const rows = await db.update(oauthTokens).set({ revokedAt: new Date() }).where(isNull(oauthTokens.revokedAt)).returning({ id: oauthTokens.id });
  return rows.length;
}

/* ====================================================================== */

export function oauthRouter(db: Db, config: AppConfig): Router {
  const router = express.Router();
  const secure = config.isProd;

  // the discovery documents and the token / registration endpoints are called by other sites' code (e.g. MCP Inspector)
  const cors = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  };
  const form = express.urlencoded({ extended: false, limit: '16kb' });

  /* ---------- discovery ---------- */
  const protectedResource = (req: Request, res: Response) => {
    const origin = originOf(req, config);
    res.json({ resource: mcpUrlOf(origin), authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'IELTS Practice' });
  };
  router.all(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], cors, protectedResource);

  router.all('/.well-known/oauth-authorization-server', cors, (req, res) => {
    const origin = originOf(req, config);
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE],
      authorization_response_iss_parameter_supported: true
    });
  });

  /* ---------- dynamic client registration (RFC 7591): public clients only ---------- */
  router.all('/oauth/register', cors, rateLimit({ name: 'oauth-register', windowMs: 60 * 60_000, max: 20 }), async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'invalid_request', error_description: 'Use POST.' }); return; }
    const b = (req.body ?? {}) as { redirect_uris?: unknown; client_name?: unknown };
    const uris = b.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || uris.some(u => typeof u !== 'string')) {
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must be a list of 1–10 URLs.' });
      return;
    }
    const refused = (uris as string[]).filter(u => !isAllowedRedirect(u));
    if (refused.length) {
      console.warn(`[oauth] registration refused (redirect ${refused.join(', ')}) from ${req.ip}`);
      res.status(400).json({ error: 'invalid_redirect_uri', error_description: `This server only accepts Claude's callback (${CLAUDE_CALLBACKS[0]}) or a loopback (http://localhost) redirect. Refused: ${refused.join(', ')}` });
      return;
    }
    // keep the table small: forget registrations that never connected
    await db.delete(oauthClients).where(and(isNull(oauthClients.lastUsedAt), lt(oauthClients.createdAt, new Date(Date.now() - 86400_000))));
    const [{ n }] = await db.select({ n: count() }).from(oauthClients) as [{ n: number }];
    if (Number(n) >= MAX_CLIENTS) {
      res.status(400).json({ error: 'invalid_client_metadata', error_description: 'Too many registered apps. Try again tomorrow.' });
      return;
    }
    const clientId = newSecret('client');
    const clientName = typeof b.client_name === 'string' ? b.client_name.slice(0, 100) : null;
    await db.insert(oauthClients).values({ clientId, clientName, redirectUris: uris as string[] });
    console.log(`[oauth] registered client "${clientName ?? '?'}" from ${req.ip}`);
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientName ? { client_name: clientName } : {}),
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPE
    });
  });

  /* ---------- authorization: the owner approves the connection ---------- */
  interface AuthParams { response_type: string; client_id: string; redirect_uri: string; code_challenge: string; code_challenge_method: string; state: string; scope: string; resource: string }
  const FIELDS: Array<keyof AuthParams> = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'];
  const readParams = (src: Record<string, unknown>): AuthParams =>
    Object.fromEntries(FIELDS.map(f => [f, typeof src[f] === 'string' ? (src[f] as string).slice(0, 2000) : ''])) as unknown as AuthParams;

  const getClient = async (clientId: string) => {
    if (!clientId) return null;
    const [c] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
    return c ?? null;
  };

  function redirectBack(res: Response, redirectUri: string, params: Record<string, string>) {
    const u = new URL(redirectUri);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    res.redirect(302, u.toString());
  }

  function page(res: Response, status: number, title: string, body: string, formAction?: string) {
    res.status(status);
    res.setHeader('Cache-Control', 'no-store');
    // the Allow button posts here and is then redirected to the app: form-action must allow that address too
    res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'${formAction ? ` ${formAction}` : ''}; frame-ancestors 'none'; base-uri 'none'`);
    // with the site-wide "no-referrer", browsers send "Origin: null" on the Allow form; same-origin keeps the real origin
    res.setHeader('Referrer-Policy', 'same-origin');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · IELTS Practice</title><style>
body{margin:0;font:15px/1.5 "Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;background:#f4f5f7;color:#1b2330;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.card{background:#fff;border:1px solid #e2e5ea;border-radius:12px;box-shadow:0 12px 32px rgba(16,24,40,.12);padding:28px;max-width:440px;width:100%;box-sizing:border-box}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}.mark{display:inline-grid;place-items:center;width:38px;height:38px;border-radius:9px;background:#b91c1c;color:#fff;font-weight:800}
h1{font-size:20px;margin:0 0 10px}ul{padding-left:20px;margin:10px 0 16px}li{margin-bottom:4px}.muted{color:#667085;font-size:13.5px}
.actions{display:flex;gap:10px;margin-top:20px}button{font:inherit;font-weight:600;padding:10px 18px;border-radius:8px;border:1px solid #cfd4dc;background:#fff;cursor:pointer;flex:1}
button.primary{background:#1d4ed8;border-color:#1d4ed8;color:#fff}code{font-size:13px;background:#f8f9fb;border:1px solid #e2e5ea;border-radius:4px;padding:0 4px}
</style></head><body><main class="card"><div class="brand"><span class="mark">IE</span><b>IELTS Practice</b></div>${body}</main></body></html>`);
  }
  const errorPage = (res: Response, message: string) =>
    page(res, 400, 'Cannot connect', `<h1>Cannot connect</h1><p>${esc(message)}</p><p class="muted">In Claude, remove the connector and add it again. If this keeps happening, check the address: it must be the site's <code>/mcp</code> address.</p>`);

  /** problems with the request that are reported back to the app (after the client and redirect are known to be good) */
  function paramProblem(p: AuthParams, origin: string): { error: string; description: string } | null {
    if (p.response_type !== 'code') return { error: 'unsupported_response_type', description: 'Only response_type=code is supported.' };
    if (!p.code_challenge || p.code_challenge_method !== 'S256') return { error: 'invalid_request', description: 'PKCE with code_challenge_method=S256 is required.' };
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge)) return { error: 'invalid_request', description: 'code_challenge is malformed.' };
    if (p.resource && p.resource.replace(/\/$/, '') !== mcpUrlOf(origin) && p.resource.replace(/\/$/, '') !== origin) {
      return { error: 'invalid_target', description: `resource must be ${mcpUrlOf(origin)}` };
    }
    if (p.scope && p.scope.split(' ').some(s => s && s !== SCOPE && s !== 'offline_access')) return { error: 'invalid_scope', description: `Supported scope: ${SCOPE}` };
    return null;
  }

  async function checkClient(p: AuthParams, res: Response) {
    const client = await getClient(p.client_id);
    if (!client) { errorPage(res, 'This connection request comes from an app this site does not know (its registration may have expired).'); return null; }
    if (!p.redirect_uri || !redirectMatches(client.redirectUris, p.redirect_uri)) { errorPage(res, 'The return address of this request was not registered by the app.'); return null; }
    return client;
  }

  const csrfOf = (req: Request, res: Response) => {
    let token = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    if (!token) {
      token = randomBytes(24).toString('base64url');
      setCookie(res, CSRF_COOKIE, token, { secure, sameSite: 'Strict', maxAgeSec: 30 * 86400 });
    }
    return token;
  };

  const authorizeLimiter = rateLimit({ name: 'oauth-authorize', windowMs: 60_000, max: 60 });

  router.get('/oauth/authorize', authorizeLimiter, async (req, res) => {
    const origin = originOf(req, config);
    const p = readParams(req.query as Record<string, unknown>);
    const client = await checkClient(p, res);
    if (!client) return;
    const problem = paramProblem(p, origin);
    if (problem) { redirectBack(res, p.redirect_uri, { error: problem.error, error_description: problem.description, state: p.state, iss: origin }); return; }
    if (!res.locals.session) { res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`); return; }

    const name = client.clientName || 'An app';
    const back = new URL(p.redirect_uri);
    const hidden = FIELDS.map(f => `<input type="hidden" name="${f}" value="${esc(p[f])}">`).join('');
    page(res, 200, 'Connect to Claude', `
<h1>Allow ${esc(name)} to use your IELTS site?</h1>
<p>${esc(name)} will be able to:</p>
<ul><li>add tests and homework, fix them and archive them</li><li>read your answers, times and scores</li><li>save its marking and feedback on your results</li></ul>
<p class="muted">You will go back to <b>${esc(back.host)}</b>. You can disconnect at any time on the Tests page; changing your password also disconnects it.</p>
<form method="post" action="/oauth/authorize">${hidden}<input type="hidden" name="csrf" value="${esc(csrfOf(req, res))}">
<div class="actions"><button type="submit" name="decision" value="deny">Cancel</button><button class="primary" type="submit" name="decision" value="allow" autofocus>Allow</button></div></form>`,
    back.origin);
  });

  router.post('/oauth/authorize', authorizeLimiter, form, async (req, res) => {
    const origin = originOf(req, config);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const p = readParams(body);
    // "null" is what a browser sends under a no-referrer policy: rely on the CSRF token (its cookie is SameSite=Strict) then
    const sentOrigin = req.get('origin') === 'null' ? undefined : req.get('origin');
    const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE] ?? '';
    const csrf = typeof body.csrf === 'string' ? body.csrf : '';
    if ((sentOrigin && sentOrigin !== origin) || !cookie || !same(cookie, csrf)) { errorPage(res, 'The approval form expired or came from another site. Start the connection again from Claude.'); return; }
    if (!res.locals.session) { res.redirect(302, `/login?next=${encodeURIComponent(`/oauth/authorize?${new URLSearchParams(p as unknown as Record<string, string>)}`)}`); return; }
    const client = await checkClient(p, res);
    if (!client) return;
    const problem = paramProblem(p, origin);
    if (problem) { redirectBack(res, p.redirect_uri, { error: problem.error, error_description: problem.description, state: p.state, iss: origin }); return; }
    if (body.decision !== 'allow') {
      console.log(`[oauth] connection refused by the owner (client "${client.clientName ?? '?'}")`);
      redirectBack(res, p.redirect_uri, { error: 'access_denied', error_description: 'The owner did not allow the connection.', state: p.state, iss: origin });
      return;
    }
    const code = newSecret('code');
    codes.set(sha256hex(code), {
      clientId: client.clientId, clientName: client.clientName, redirectUri: p.redirect_uri, challenge: p.code_challenge,
      scope: SCOPE, resource: mcpUrlOf(origin), expiresAt: Date.now() + CODE_TTL_MS
    });
    await db.update(oauthClients).set({ lastUsedAt: new Date() }).where(eq(oauthClients.clientId, client.clientId));
    console.log(`[oauth] connection approved for client "${client.clientName ?? '?'}"`);
    redirectBack(res, p.redirect_uri, { code, state: p.state, iss: origin });
  });

  /* ---------- tokens ---------- */
  async function issue(res: Response, c: { clientId: string; clientName: string | null; scope: string; resource: string; familyId: string }) {
    const access = newSecret('at'), refresh = newSecret('rt');
    const now = Date.now();
    const base = { clientId: c.clientId, clientName: c.clientName, scope: c.scope, resource: c.resource, familyId: c.familyId, passwordTag: passwordTag(config.adminPasswordHash) };
    await db.insert(oauthTokens).values([
      { ...base, kind: 'access', tokenHash: sha256hex(access), expiresAt: new Date(now + ACCESS_TTL_SEC * 1000) },
      { ...base, kind: 'refresh', tokenHash: sha256hex(refresh), expiresAt: new Date(now + REFRESH_TTL_SEC * 1000) }
    ]);
    // housekeeping: tokens that ran out more than a week ago
    void db.delete(oauthTokens).where(lt(oauthTokens.expiresAt, new Date(now - 7 * 86400_000))).catch(() => {});
    res.json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, refresh_token: refresh, scope: c.scope });
  }

  const tokenError = (res: Response, status: number, error: string, description: string) => { res.status(status).json({ error, error_description: description }); };

  router.all('/oauth/token', cors, rateLimit({ name: 'oauth-token', windowMs: 60_000, max: 60 }), form, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { tokenError(res, 405, 'invalid_request', 'Use POST.'); return; }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');
    const client = await getClient(str('client_id'));
    if (!client) { tokenError(res, 401, 'invalid_client', 'Unknown client_id.'); return; }

    if (str('grant_type') === 'authorization_code') {
      const code = str('code'), verifier = str('code_verifier');
      const key = sha256hex(code);
      const entry = codes.get(key);
      codes.delete(key); // single use, even when the request below fails
      if (!entry || entry.expiresAt < Date.now() || entry.clientId !== client.clientId || entry.redirectUri !== str('redirect_uri')) {
        tokenError(res, 400, 'invalid_grant', 'The authorization code is invalid, expired or already used.');
        return;
      }
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !same(createHash('sha256').update(verifier).digest('base64url'), entry.challenge)) {
        tokenError(res, 400, 'invalid_grant', 'PKCE verification failed.');
        return;
      }
      const resource = str('resource');
      if (resource && resource.replace(/\/$/, '') !== entry.resource && resource.replace(/\/$/, '') !== new URL(entry.resource).origin) {
        tokenError(res, 400, 'invalid_target', `resource must be ${entry.resource}`);
        return;
      }
      console.log(`[oauth] tokens issued to "${client.clientName ?? '?'}"`);
      await issue(res, { clientId: client.clientId, clientName: entry.clientName, scope: entry.scope, resource: entry.resource, familyId: randomUUID() });
      return;
    }

    if (str('grant_type') === 'refresh_token') {
      const [row] = await db.select().from(oauthTokens).where(and(eq(oauthTokens.tokenHash, sha256hex(str('refresh_token'))), eq(oauthTokens.kind, 'refresh'))).limit(1);
      const now = new Date();
      if (!row || row.clientId !== client.clientId) { tokenError(res, 400, 'invalid_grant', 'Unknown refresh token.'); return; }
      if (row.revokedAt) {
        if (now.getTime() - row.revokedAt.getTime() > REFRESH_RETRY_GRACE_MS) {
          // an old refresh token came back: someone may have copied it, so end this whole connection
          await db.update(oauthTokens).set({ revokedAt: now }).where(and(eq(oauthTokens.familyId, row.familyId), isNull(oauthTokens.revokedAt)));
          console.warn(`[oauth] reused refresh token — connection of "${row.clientName ?? '?'}" ended`);
        }
        tokenError(res, 400, 'invalid_grant', 'The refresh token was already used.');
        return;
      }
      if (row.expiresAt <= now || row.passwordTag !== passwordTag(config.adminPasswordHash)) { tokenError(res, 400, 'invalid_grant', 'The refresh token expired or the password was changed.'); return; }
      // rotate: this refresh token and the access tokens issued with it end now
      await db.update(oauthTokens).set({ revokedAt: now }).where(and(eq(oauthTokens.familyId, row.familyId), isNull(oauthTokens.revokedAt), or(eq(oauthTokens.id, row.id), eq(oauthTokens.kind, 'access'))));
      await issue(res, { clientId: row.clientId, clientName: row.clientName, scope: row.scope, resource: row.resource, familyId: row.familyId });
      return;
    }
    tokenError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  });

  /* ---------- revocation (RFC 7009): always 200 ---------- */
  router.all('/oauth/revoke', cors, rateLimit({ name: 'oauth-revoke', windowMs: 60_000, max: 30 }), form, async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    const token = typeof (req.body as Record<string, unknown> | undefined)?.token === 'string' ? (req.body as { token: string }).token : '';
    const [row] = token ? await db.select().from(oauthTokens).where(eq(oauthTokens.tokenHash, sha256hex(token))).limit(1) : [];
    if (row) {
      await db.update(oauthTokens).set({ revokedAt: new Date() }).where(and(eq(oauthTokens.familyId, row.familyId), isNull(oauthTokens.revokedAt)));
      console.log(`[oauth] connection of "${row.clientName ?? '?'}" revoked by the app`);
    }
    res.status(200).end();
  });

  return router;
}

/** where /login may send the browser after logging in: only back into the approval page */
export function safeNext(next: unknown): string | null {
  return typeof next === 'string' && next.startsWith('/oauth/authorize?') && !next.includes('\\') ? next : null;
}
