import type { AccountResponse } from '@ielts/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAccount } from '../src/auth/account';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { loadConfig } from '../src/config';
import { account } from '../src/db/schema';
import { Client, PASSWORD, startServer, type TestServer } from './helpers';

let srv: TestServer;
beforeAll(async () => { srv = await startServer(); });
afterAll(async () => { await srv.close(); });

const json = async <T = Record<string, unknown>>(r: Response) => (await r.json()) as T;
const NEW_PASSWORD = 'a much longer password';

async function loggedIn(password = PASSWORD, username?: string): Promise<Client> {
  const c = new Client(srv.url);
  await c.get('/login');
  const r = await c.post('/api/auth/login', { password, ...(username !== undefined ? { username } : {}) });
  expect(r.status).toBe(200);
  return c;
}

describe('Settings: username and password (Phase 13)', () => {
  it('starts with the password from the server and no username', async () => {
    const me = await loggedIn();
    expect(await json<AccountResponse>(await me.get('/api/account'))).toEqual({ username: null, passwordSetOnSite: false, passwordChangedAt: null });
    expect(await json(await me.get('/api/auth/me'))).toEqual({ loggedIn: true, usernameRequired: false });
    // without a username, whatever is typed in the Username box is ignored
    await loggedIn(PASSWORD, 'anything');
    expect((await new Client(srv.url).get('/api/account')).status).toBe(401);
  });

  it('sets a username: the login then needs it (any letter case)', async () => {
    const me = await loggedIn();
    const wrong = await me.post('/api/account/username', { currentPassword: 'nope', username: 'learner' });
    expect(wrong.status).toBe(403); // not 401, which would send the page to the login screen
    expect((await json(wrong)).message).toMatch(/current password/);
    const bad = await me.post('/api/account/username', { currentPassword: PASSWORD, username: 'a b' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(await json(bad))).toMatch(/3–40 letters/);

    const ok = await me.post('/api/account/username', { currentPassword: PASSWORD, username: '  Learner.01 ' });
    expect(ok.status).toBe(200);
    expect((await json<AccountResponse>(ok)).username).toBe('Learner.01');

    const anon = new Client(srv.url);
    await anon.get('/login');
    expect(await json(await anon.get('/api/auth/me'))).toEqual({ loggedIn: false, usernameRequired: true });
    const noName = await anon.post('/api/auth/login', { password: PASSWORD });
    expect(noName.status).toBe(401);
    expect((await json(noName)).message).toBe('Wrong username or password.');
    expect((await anon.post('/api/auth/login', { password: PASSWORD, username: 'other' })).status).toBe(401);
    await loggedIn(PASSWORD, 'learner.01');
    expect((await me.get('/api/dashboard')).status).toBe(200); // changing the username logs nobody out

    // an empty username goes back to password-only
    expect((await json<AccountResponse>(await me.post('/api/account/username', { currentPassword: PASSWORD, username: '' }))).username).toBeNull();
    await loggedIn(PASSWORD);
  });

  it('changes the password: this device stays in, every other device is logged out', async () => {
    const me = await loggedIn();
    const phone = await loggedIn();
    expect((await me.post('/api/account/password', { currentPassword: 'nope', newPassword: NEW_PASSWORD })).status).toBe(403);
    const short = await me.post('/api/account/password', { currentPassword: PASSWORD, newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(JSON.stringify(await json(short))).toMatch(/at least 12 characters/);
    expect((await me.post('/api/account/password', { currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(400);

    const ok = await me.post('/api/account/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    const body = await json<AccountResponse & { loggedOut: number }>(ok);
    expect(body.loggedOut).toBeGreaterThanOrEqual(1);
    expect(body.passwordSetOnSite).toBe(true);
    expect(body.passwordChangedAt).toBeTruthy();

    expect((await me.get('/api/dashboard')).status).toBe(200);
    expect((await phone.get('/api/dashboard')).status).toBe(401);
    const old = new Client(srv.url);
    await old.get('/login');
    expect((await old.post('/api/auth/login', { password: PASSWORD })).status).toBe(401);
    await loggedIn(NEW_PASSWORD);

    // a restart keeps the new password and the username (the row is read on start)
    const restarted = { ...srv.config, adminPasswordHash: srv.config.envPasswordHash, adminUsername: undefined };
    await loadAccount(srv.database.db, restarted);
    expect(await verifyPassword(NEW_PASSWORD, restarted.adminPasswordHash)).toBe(true);
  });

  it('a password set later in the server .env (change-password.sh) wins over the one set on the site', async () => {
    const db = srv.database.db;
    const [row] = await db.select().from(account).where(eq(account.id, 1));
    expect(row?.passwordHash).toBeTruthy();

    // a new .env hash: the stored site password is dropped, the username kept
    await db.update(account).set({ username: 'learner' }).where(eq(account.id, 1));
    const fresh = await loadConfig({ adminPasswordHash: await hashPassword('from the server env') });
    await loadAccount(db, fresh);
    expect(fresh.adminPasswordHash).toBe(fresh.envPasswordHash);
    expect(fresh.adminUsername).toBe('learner');
    const [after] = await db.select().from(account).where(eq(account.id, 1));
    expect(after?.passwordHash).toBeNull();
    expect(after?.username).toBe('learner');
  });
});
