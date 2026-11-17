import { createHash, randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions } from '../db/schema';

export const SESSION_COOKIE = 'ielts_session';
const REFRESH_AFTER_MS = 60 * 60 * 1000; // extend a session at most once an hour

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, opts: { days: number; userAgent?: string; ip?: string }): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + opts.days * 86400_000);
  await db.insert(sessions).values({ id: digest(token), expiresAt, userAgent: opts.userAgent?.slice(0, 300) ?? null, ip: opts.ip ?? null });
  return { token, expiresAt };
}

/** the session for a cookie token, or null when unknown / expired; slides the expiry forward */
export async function findSession(db: Db, token: string | undefined, days: number): Promise<{ id: string; expiresAt: Date } | null> {
  if (!token || token.length > 100) return null;
  const id = digest(token);
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  if (now - row.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    const expiresAt = new Date(now + days * 86400_000);
    await db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.id, id));
    return { id, expiresAt };
  }
  return { id, expiresAt: row.expiresAt };
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.id, digest(token)));
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
