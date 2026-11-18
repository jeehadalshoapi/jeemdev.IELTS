import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  CreateAttemptBody, HistoryQuery, ImportBody, TestStatusBody, totalMarks, UPLOAD_MAX_BYTES, uploadKindOf,
  type ConnectorResponse, type DashboardResponse, type ImportCheckResponse, type ImportSaveResponse, type TestDetailResponse, type TestsResponse, type UploadResponse
} from '@ielts/shared';
import { desc, eq } from 'drizzle-orm';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { mountStudyRoutes } from '../study/routes';
import { Transcriber } from '../files/transcribe';
import { buildHistory } from '../attempts/history';
import { deleteRecording, saveRecording, speechFor } from '../attempts/media';
import { createAttempt, getAttemptView, getResultView, isUuid, listAttemptSummaries, saveAttempt } from '../attempts/service';
import { verifyPassword } from '../auth/password';
import { createSession, deleteSession, findSession, SESSION_COOKIE } from '../auth/sessions';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { files, tests } from '../db/schema';
import { EmptyFileError, FileTooLargeError, type FileStore } from '../files/store';
import { checkImport, prepareImport, saveImport } from '../import/service';
import { listTests, setTestStatus } from '../tests/repository';
import { mountMcp } from '../mcp';
import { listConnections, mcpUrlOf, originOf, revokeAllConnections, safeNext } from '../mcp/oauth';
import { errorHandler, HttpError, notFound } from './errors';
import { csrfProtection, ensureCsrfCookie, FailedLoginLimiter, parseCookies, rateLimit, setCookie } from './security';

export interface AppDeps { database: Database; config: AppConfig; fileStore: FileStore }

export function createApp({ database, config, fileStore }: AppDeps) {
  // speaking recordings -> text, only when a speech-to-text server is configured (WHISPER_URL)
  const transcriber = config.whisperUrl ? new Transcriber(database.db, fileStore, config.whisperUrl) : null;
  if (transcriber) void transcriber.resumePending().catch(e => console.error('[whisper] could not resume', e));
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

  /* ---------- Claude connector: OAuth endpoints and /mcp (bearer tokens, not the session cookie) ---------- */
  mountMcp(app, db, config, fileStore);

  /* ---------- pages ---------- */
  const page = (name: 'index.html' | 'login.html') => (req: Request, res: Response) => {
    const file = path.join(config.webDir, name);
    if (!existsSync(file)) { res.status(500).type('text').send('The website has not been built. Run: npm run build'); return; }
    ensureCsrfCookie(req, res, config.isProd);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(file);
  };
  app.get('/login', (req, res) => {
    // ?next= only ever leads back to the connector's approval page
    if (res.locals.session) res.redirect(safeNext(req.query.next) ?? '/');
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

  /* ---------- Phase 6: speaking recordings and listening read-aloud ---------- */
  api.post('/attempts/:id/recordings', async (req, res) => {
    const itemId = String(req.query.item ?? '');
    const duration = Number(req.query.duration);
    const num = (k: string) => { const v = Number(req.query[k]); return req.query[k] !== undefined && Number.isFinite(v) ? v : undefined; };
    const pauses = num('pauses'), longest = num('longestPause'), speaking = num('speaking');
    const rec = await saveRecording(db, fileStore, {
      attemptId: req.params.id, itemId, mimeType: (req.get('content-type') ?? '').toLowerCase(),
      ...(Number.isFinite(duration) ? { durationSec: duration } : {}),
      ...(pauses !== undefined ? { pausesOver3s: pauses } : {}), ...(longest !== undefined ? { longestPauseSec: longest } : {}), ...(speaking !== undefined ? { speakingSec: speaking } : {}),
      contentLength: Number(req.get('content-length') ?? 0), stream: req
    });
    console.log(`[recording] ${req.params.id} ${itemId} (${rec.sizeBytes} bytes)`);
    transcriber?.enqueue(rec.id);
    res.status(201).json(rec);
  });
  api.delete('/attempts/:id/recordings/:itemId', async (req, res) => {
    await deleteRecording(db, fileStore, req.params.id, req.params.itemId);
    res.json({ ok: true });
  });
  api.get('/attempts/:id/speech/:partId', async (req, res) => { res.json(await speechFor(db, req.params.id, req.params.partId)); });
  mountStudyRoutes(api, db);
  api.get('/history', async (req, res) => {
    const q = HistoryQuery.parse(req.query);
    res.json(await buildHistory(db, { ...(q.skill ? { skill: q.skill } : {}), ...(q.since ? { since: new Date(`${q.since}T00:00:00Z`) } : {}) }));
  });

  /* ---------- the Claude connector, seen from the website ---------- */
  api.get('/connector', async (req, res) => {
    const body: ConnectorResponse = { mcpUrl: mcpUrlOf(originOf(req, config)), connections: await listConnections(db, config) };
    res.json(body);
  });
  api.post('/connector/disconnect', async (_req, res) => {
    const n = await revokeAllConnections(db);
    console.log(`[oauth] the owner disconnected every app (${n} token(s) revoked)`);
    res.json({ ok: true });
  });
  api.patch('/attempts/:id', async (req, res) => { res.json(await saveAttempt(db, req.params.id, req.body, req.get('user-agent'))); });
  api.post('/attempts/:id/submit', async (req, res) => {
    const r = await saveAttempt(db, req.params.id, req.body, req.get('user-agent'), { submit: true });
    console.log(`[attempt] ${req.params.id} submitted`);
    res.json(r);
  });

  /* ---------- import box and test management (Phase 4) ---------- */
  api.get('/tests', async (_req, res) => {
    const list = await listTests(db, { limit: 200 });
    const body: TestsResponse = { tests: list.map(t => ({ ...t, createdAt: t.createdAt.toISOString() })) };
    res.json(body);
  });

  api.patch('/tests/:id', async (req, res) => {
    if (!isUuid(req.params.id)) throw notFound('Test not found');
    const { status } = TestStatusBody.parse(req.body ?? {});
    const row = await setTestStatus(db, req.params.id, status);
    if (!row) throw notFound('Test not found');
    console.log(`[test] ${row.id} -> ${status}`);
    res.json(row);
  });

  api.post('/import/check', async (req, res) => {
    const { doc: _doc, fileIds: _fileIds, ...result } = await checkImport(db, ImportBody.parse(req.body ?? {}));
    const body: ImportCheckResponse = result;
    res.json(body);
  });

  api.post('/import', async (req, res) => {
    const input = ImportBody.parse(req.body ?? {});
    const r = prepareImport(input.source, input.files);
    if (!r.ok) throw new HttpError(400, 'invalid_test', `The test has ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}. Check it and fix ${r.errors.length === 1 ? 'it' : 'them'} first.`, r.errors);
    const saved = await saveImport(db, r);
    console.log(`[import] test ${saved.id} saved from ${r.format} (${r.fileIds.length} file(s))`);
    const body: ImportSaveResponse = { ...saved, warnings: r.warnings };
    res.status(201).json(body);
  });

  // audio / pictures for tests: the raw file is the body, its name is ?name=
  api.post('/files', async (req, res) => {
    const name = String(req.query.name ?? '').trim().slice(0, 255);
    if (!name) throw new HttpError(400, 'invalid_request', 'Add the file name: POST /api/files?name=part1.mp3');
    const mime = (req.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const kind = uploadKindOf(mime);
    if (!kind) throw new HttpError(415, 'unsupported_type', `"${name}" cannot be uploaded: only audio (MP3, M4A, WAV, OGG, WEBM, FLAC) and pictures (PNG, JPG, GIF, WEBP) are allowed.`);
    const max = UPLOAD_MAX_BYTES[kind];
    const tooLarge = () => new HttpError(413, 'too_large', `"${name}" is larger than ${max / 1024 / 1024} MB.`);
    if (Number(req.get('content-length') ?? 0) > max) throw tooLarge();
    try {
      const saved = await fileStore.saveStream({ stream: req, maxBytes: max, originalName: name, mimeType: mime, kind });
      console.log(`[upload] ${kind} ${saved.id} (${saved.sizeBytes} bytes)`);
      const body: UploadResponse = { id: saved.id, url: saved.url, name, kind, sizeBytes: saved.sizeBytes };
      res.status(201).json(body);
    } catch (e) {
      if (e instanceof FileTooLargeError) throw tooLarge();
      if (e instanceof EmptyFileError) throw new HttpError(400, 'empty_file', `"${name}" is empty.`);
      throw e;
    }
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
    // drawings from upload_asset: cleaned when saved, and opened on their own they still cannot run anything
    if (f.mimeType === 'image/svg+xml') res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    // "root" limits the dotfile check to the stored name (the upload folder itself may be e.g. ".data/uploads")
    res.sendFile(f.storagePath, { root: fileStore.rootDir, dotfiles: 'deny' });
  });

  app.use((req, res) => { res.status(404).type('text').send('Not found'); });
  app.use(errorHandler);
  return app;
}
