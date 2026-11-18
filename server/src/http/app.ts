import { existsSync } from 'node:fs';
import path from 'node:path';
import { CreateAttemptBody, totalMarks, type DashboardResponse, type TestDetailResponse } from '@ielts/shared';
import { desc, eq } from 'drizzle-orm';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { buildHistory } from '../attempts/history';
import { createAttempt, getAttemptView, getResultView, isUuid, listAttemptSummaries, saveAttempt } from '../attempts/service';
import { verifyPassword } from '../auth/password';
import { createSession, deleteSession, findSession, SESSION_COOKIE } from '../auth/sessions';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { files, tests } from '../db/schema';
import type { FileStore } from '../files/store';
import { errorHandler, HttpError, notFound } from './errors';
import { csrfProtection, ensureCsrfCookie, FailedLoginLimiter, parseCookies, rateLimit, setCookie } from './security';

export interface AppDeps { database: Database; config: AppConfig; fileStore: FileStore }

export function createApp({ database, config, fileStore }: AppDeps) {
  const db = database.db;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind the edge Caddy proxy: honour X-Forwarded-For / -Proto

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        mediaSrc: ["'self'", 'https:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null
      }
    },
    hsts: config.isProd ? { maxAge: 31536000 } : false
  }));
  app.use(express.json({ limit: '1mb' }));

  // health check for Docker and the uptime monitor — no data, no login
  app.get('/health', async (_req, res) => {
    const ok = await database.ping();
    res.status(ok ? 200 : 503).json({ ok, db: ok ? 'up' : 'down' });
  });

  // who is logged in?
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    res.locals.session = await findSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE], config.sessionDays);
    next();
  });
  const sessionCookie = { httpOnly: true, secure: config.isProd, sameSite: 'Lax' as const };

  /* ---------- pages ---------- */
  const page = (name: 'index.html' | 'login.html') => (req: Request, res: Response) => {
    const file = path.join(config.webDir, name);
    if (!existsSync(file)) { res.status(500).type('text').send('The website has not been built. Run: npm run build'); return; }
    ensureCsrfCookie(req, res, config.isProd);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(file);
  };
  app.get('/login', (req, res) => {
    if (res.locals.session) res.redirect('/');
    else page('login.html')(req, res);
  });
  app.get(['/', '/index.html'], (req, res) => {
    if (res.locals.session) page('index.html')(req, res);
    else res.redirect('/login');
  });
  // hashed JS / CSS bundles: no data in them, cached for a year
  app.use('/assets', express.static(path.join(config.webDir, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }));

  /* ---------- auth API ---------- */
  const api = express.Router();
  api.use(csrfProtection(config.publicOrigin));
  api.use(rateLimit({ name: 'api', windowMs: 60_000, max: 600 }));

  api.get('/auth/me', (_req, res) => { res.json({ loggedIn: !!res.locals.session }); });

  const loginLimiter = new FailedLoginLimiter(10, 15 * 60_000);
  api.post('/auth/login', rateLimit({ name: 'login-requests', windowMs: 60_000, max: 30 }), async (req, res) => {
    loginLimiter.check(req.ip);
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body ?? {});
    if (!(await verifyPassword(password, config.adminPasswordHash))) {
      loginLimiter.fail(req.ip);
      console.warn(`[auth] failed login from ${req.ip}`);
      await new Promise(r => setTimeout(r, 400));
      throw new HttpError(401, 'wrong_password', 'Wrong password.');
    }
    loginLimiter.succeed(req.ip);
    const { token } = await createSession(db, { days: config.sessionDays, userAgent: req.get('user-agent'), ...(req.ip ? { ip: req.ip } : {}) });
    setCookie(res, SESSION_COOKIE, token, { ...sessionCookie, maxAgeSec: config.sessionDays * 86400 });
    console.log(`[auth] login from ${req.ip}`);
    res.json({ ok: true });
  });

  api.post('/auth/logout', async (req, res) => {
    await deleteSession(db, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    setCookie(res, SESSION_COOKIE, '', { ...sessionCookie, maxAgeSec: 0 });
    res.json({ ok: true });
  });

  // everything below needs a session
  api.use((_req, res, next) => (res.locals.session ? next() : next(new HttpError(401, 'not_logged_in', 'Please log in.'))));
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  api.get('/dashboard', async (_req, res) => {
    const testRows = await db.select().from(tests).where(eq(tests.status, 'assigned')).orderBy(desc(tests.createdAt));
    const summaries = await listAttemptSummaries(db);
    const body: DashboardResponse = {
      assigned: testRows.map(t => ({
        id: t.id, title: t.title, skill: t.skill, kind: t.kind, dueDate: t.dueDate,
        timeLimitMin: t.content.timeLimitMin ?? null, marks: totalMarks(t.content.parts), parts: t.content.parts.length,
        createdAt: t.createdAt.toISOString(),
        attemptCount: summaries.filter(s => s.testId === t.id).length,
        inProgressAttemptId: summaries.find(s => s.testId === t.id && s.status === 'in_progress')?.id ?? null
      })),
      inProgress: summaries.filter(s => s.status === 'in_progress'),
      completed: summaries.filter(s => s.status !== 'in_progress').sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
    };
    res.json(body);
  });

  api.get('/tests/:id', async (req, res) => {
    const id = req.params.id;
    if (!isUuid(id)) throw notFound('Test not found');
    const [t] = await db.select().from(tests).where(eq(tests.id, id)).limit(1);
    if (!t) throw notFound('Test not found');
    const body: TestDetailResponse = {
      test: {
        id: t.id, title: t.title, skill: t.skill, kind: t.kind, status: t.status, instructions: t.instructions, dueDate: t.dueDate,
        marks: totalMarks(t.content.parts), timeLimitMin: t.content.timeLimitMin ?? null,
        parts: t.content.parts.map(p => ({ id: p.id, title: p.title, skill: p.skill ?? null, marks: totalMarks([p]) }))
      },
      attempts: await listAttemptSummaries(db, { testId: id })
    };
    res.json(body);
  });

  api.post('/tests/:id/attempts', async (req, res) => {
    const { mode, device } = CreateAttemptBody.parse(req.body ?? {});
    const ua = req.get('user-agent');
    const id = await createAttempt(db, req.params.id, mode, { ...(device ? { id: device } : {}), ...(ua ? { ua } : {}) });
    res.status(201).json({ id });
  });

  api.get('/attempts/:id', async (req, res) => { res.json(await getAttemptView(db, req.params.id)); });
  api.get('/attempts/:id/result', async (req, res) => { res.json(await getResultView(db, req.params.id)); });
  api.get('/history', async (_req, res) => { res.json(await buildHistory(db)); });
  api.patch('/attempts/:id', async (req, res) => { res.json(await saveAttempt(db, req.params.id, req.body, req.get('user-agent'))); });
  api.post('/attempts/:id/submit', async (req, res) => {
    const r = await saveAttempt(db, req.params.id, req.body, req.get('user-agent'), { submit: true });
    console.log(`[attempt] ${req.params.id} submitted`);
    res.json(r);
  });

  api.use((_req, _res, next) => next(notFound('No such API route')));
  app.use('/api', api);

  /* ---------- uploaded files (audio, images) — login required ---------- */
  app.get('/files/:id', async (req, res) => {
    if (!res.locals.session) throw new HttpError(401, 'not_logged_in', 'Please log in.');
    const id = req.params.id;
    if (!isUuid(id)) throw notFound('File not found');
    const [f] = await db.select().from(files).where(eq(files.id, id)).limit(1);
    if (!f) throw notFound('File not found');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type(f.mimeType);
    res.sendFile(fileStore.absolutePath(f.storagePath), { dotfiles: 'deny' });
  });

  app.use((req, res) => { res.status(404).type('text').send('Not found'); });
  app.use(errorHandler);
  return app;
}
