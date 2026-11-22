/*
 * The single user's username and password as changed on the Settings page (Phase 13).
 *
 * The password starts as ADMIN_PASSWORD_HASH (the server's .env). A password changed on the site
 * is stored in the `account` row together with a tag of the env hash it replaced. If the env hash
 * changes later (change-password.sh on the server, the "forgot my password" route), the tag no
 * longer matches and the env password wins again; the username is kept.
 *
 * The live values sit on the AppConfig object (adminPasswordHash, adminUsername), which the login
 * route and the connector's OAuth code read.
 */
import { createHash } from 'node:crypto';
import { MIN_PASSWORD_LENGTH, type AccountResponse } from '@ielts/shared';
import { eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { AppConfig } from '../config';
import type { Db } from '../db/client';
import { account, sessions } from '../db/schema';
import { hashPassword, verifyPassword } from './password';

const ROW_ID = 1;

const envTagOf = (envHash: string) => createHash('sha256').update(`ielts-env:${envHash}`).digest('hex').slice(0, 16);

export const Username = z.string().trim().max(40)
  .refine(s => s === '' || /^[A-Za-z0-9._@-]{3,40}$/.test(s), 'Use 3–40 letters, digits or . _ @ - (no spaces), or leave it empty to log in with the password only.');

export const UsernameBody = z.object({ currentPassword: z.string().max(200), username: Username });
export const PasswordBody = z.object({
  currentPassword: z.string().max(200),
  newPassword: z.string().max(200).refine(s => s.length >= MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
});

/** read the stored row onto the config; drop a site password the server's .env has replaced since */
export async function loadAccount(db: Db, config: AppConfig): Promise<void> {
  const [row] = await db.select().from(account).where(eq(account.id, ROW_ID)).limit(1);
  config.adminUsername = row?.username ?? undefined;
  if (!row?.passwordHash) return;
  if (row.envTag === envTagOf(config.envPasswordHash)) {
    config.adminPasswordHash = row.passwordHash;
  } else {
    await db.update(account).set({ passwordHash: null, envTag: null, updatedAt: new Date() }).where(eq(account.id, ROW_ID));
    console.log('[auth] the password in the server .env was changed: it replaces the one set on the site');
  }
}

export async function accountView(db: Db, config: AppConfig): Promise<AccountResponse> {
  const [row] = await db.select().from(account).where(eq(account.id, ROW_ID)).limit(1);
  return {
    username: config.adminUsername ?? null,
    passwordSetOnSite: config.adminPasswordHash !== config.envPasswordHash,
    passwordChangedAt: row?.passwordHash && row.passwordChangedAt ? row.passwordChangedAt.toISOString() : null
  };
}

/** the login check: username (when one is set, any letter case) + password */
export async function checkLogin(config: AppConfig, username: string | undefined, password: string): Promise<boolean> {
  const passwordOk = await verifyPassword(password, config.adminPasswordHash);
  const want = config.adminUsername;
  const userOk = !want || (username ?? '').trim().toLowerCase() === want.toLowerCase();
  return passwordOk && userOk;
}

export const checkPassword = (config: AppConfig, password: string) => verifyPassword(password, config.adminPasswordHash);

async function upsert(db: Db, values: Partial<typeof account.$inferInsert>): Promise<void> {
  const now = new Date();
  await db.insert(account).values({ id: ROW_ID, ...values, updatedAt: now })
    .onConflictDoUpdate({ target: account.id, set: { ...values, updatedAt: now } });
}

export async function setUsername(db: Db, config: AppConfig, username: string): Promise<string | null> {
  const value = username.trim() || null;
  await upsert(db, { username: value });
  config.adminUsername = value ?? undefined;
  return value;
}

/**
 * New password: stored on the site, every OTHER session logged out (this device stays in).
 * The connector's tokens carry a tag of the password hash, so Claude is disconnected too.
 */
export async function setPassword(db: Db, config: AppConfig, newPassword: string, keepSessionId: string): Promise<{ loggedOut: number }> {
  const hash = await hashPassword(newPassword);
  await upsert(db, { passwordHash: hash, envTag: envTagOf(config.envPasswordHash), passwordChangedAt: new Date() });
  config.adminPasswordHash = hash;
  const gone = await db.delete(sessions).where(ne(sessions.id, keepSessionId)).returning({ id: sessions.id });
  return { loggedOut: gone.length };
}
