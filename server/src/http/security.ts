import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors';

/* ---------- cookies ---------- */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export interface CookieOptions { httpOnly?: boolean; secure: boolean; sameSite: 'Lax' | 'Strict'; maxAgeSec?: number; path?: string }

export function setCookie(res: Response, name: string, value: string, o: CookieOptions): void {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, `SameSite=${o.sameSite}`];
  if (o.httpOnly) bits.push('HttpOnly');
  if (o.secure) bits.push('Secure');
  if (o.maxAgeSec !== undefined) bits.push(`Max-Age=${Math.max(0, Math.floor(o.maxAgeSec))}`);
  res.append('Set-Cookie', bits.join('; '));
}

/* ---------- CSRF: double-submit token + same-origin check ----------
   The page reads the (non-httpOnly) ielts_csrf cookie and echoes it in the X-CSRF-Token header.
   Another site can make the browser send cookies, but cannot read them, so it cannot forge the header. */
export const CSRF_COOKIE = 'ielts_csrf';

export function ensureCsrfCookie(req: Request, res: Response, secure: boolean): void {
  if (!parseCookies(req.headers.cookie)[CSRF_COOKIE]) {
    setCookie(res, CSRF_COOKIE, randomBytes(24).toString('base64url'), { secure, sameSite: 'Strict', maxAgeSec: 30 * 86400 });
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function csrfProtection(publicOrigin: string | undefined) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const expectedOrigin = publicOrigin ?? `${req.protocol}://${req.get('host')}`;
    const origin = req.get('origin');
    if (origin && origin !== expectedOrigin) return next(new HttpError(403, 'bad_origin', 'Request from another site was refused.'));
    const cookie = parseCookies(req.headers.cookie)[CSRF_COOKIE];
    const header = req.get('x-csrf-token');
    if (!cookie || !header || !same(cookie, header)) return next(new HttpError(403, 'csrf', 'Missing or wrong security token. Reload the page and try again.'));
    next();
  };
}

/* ---------- login lockout: counts only FAILED passwords per IP ---------- */
export class FailedLoginLimiter {
  private fails = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly max = 10, private readonly windowMs = 15 * 60_000) {}

  /** throws 429 while this IP has too many recent failures */
  check(ip: string | undefined): void {
    const f = this.fails.get(ip ?? '?');
    if (f && f.resetAt > Date.now() && f.count >= this.max) {
      console.warn(`[rate-limit] login: ${ip} blocked after ${f.count} wrong passwords`);
      throw new HttpError(429, 'rate_limited', 'Too many wrong passwords. Wait 15 minutes and try again.');
    }
  }

  fail(ip: string | undefined): void {
    const key = ip ?? '?', now = Date.now();
    const f = this.fails.get(key);
    if (!f || f.resetAt <= now) this.fails.set(key, { count: 1, resetAt: now + this.windowMs });
    else f.count++;
  }

  succeed(ip: string | undefined): void { this.fails.delete(ip ?? '?'); }
}

/* ---------- rate limiting (in memory; one app instance) ---------- */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, opts.windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.resetAt <= now) { h = { count: 0, resetAt: now + opts.windowMs }; hits.set(key, h); }
    h.count++;
    if (h.count > opts.max) {
      res.setHeader('Retry-After', String(Math.ceil((h.resetAt - now) / 1000)));
      console.warn(`[rate-limit] ${opts.name}: ${key} blocked (${h.count} requests)`);
      return next(new HttpError(429, 'rate_limited', 'Too many attempts. Wait a few minutes and try again.'));
    }
    next();
  };
}
