import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { hashPassword } from '../src/auth/password';
import { loadConfig, type AppConfig } from '../src/config';
import { openDatabase, type Database } from '../src/db/client';
import { FileStore } from '../src/files/store';
import { createApp } from '../src/http/app';

export const PASSWORD = 'correct horse battery';

export interface TestServer {
  url: string;
  database: Database;
  fileStore: FileStore;
  config: AppConfig;
  close(): Promise<void>;
}

/** the real app on a random port, with an in-memory database and stub HTML pages */
export async function startServer(): Promise<TestServer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ielts-test-'));
  const webDir = path.join(dir, 'web');
  await import('node:fs/promises').then(fs => fs.mkdir(path.join(webDir, 'assets'), { recursive: true }));
  await writeFile(path.join(webDir, 'index.html'), '<!doctype html><title>app</title>');
  await writeFile(path.join(webDir, 'login.html'), '<!doctype html><title>login</title>');
  const database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate();
  const config = await loadConfig({ adminPasswordHash: await hashPassword(PASSWORD), webDir, uploadDir: path.join(dir, '.data', 'uploads'), isProd: false });
  const fileStore = new FileStore(database.db, config.uploadDir);
  const app = createApp({ database, config, fileStore });
  const server: Server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, database, fileStore, config,
    close: async () => {
      await new Promise(r => server.close(r));
      await database.close();
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/** a tiny browser: keeps cookies and sends the CSRF header like the website does */
export class Client {
  cookies: Record<string, string> = {};
  constructor(readonly base: string, readonly origin = base) {}

  async request(method: string, p: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = { origin: this.origin, ...extraHeaders };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    if (cookie) headers.cookie = cookie;
    if (this.cookies.ielts_csrf && !('x-csrf-token' in extraHeaders)) headers['x-csrf-token'] = this.cookies.ielts_csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(this.base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i), value = decodeURIComponent(pair!.slice(i + 1));
      if (/Max-Age=0/i.test(sc)) delete this.cookies[name]; else this.cookies[name] = value;
    }
    return res;
  }

  get(p: string) { return this.request('GET', p); }
  post(p: string, body?: unknown, h?: Record<string, string>) { return this.request('POST', p, body ?? {}, h); }
  patch(p: string, body?: unknown) { return this.request('PATCH', p, body ?? {}); }

  async login(password = PASSWORD): Promise<Response> {
    await this.get('/login'); // receives the CSRF cookie
    return this.post('/api/auth/login', { password });
  }
}
