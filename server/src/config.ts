import path from 'node:path';
import { hashPassword, isPasswordHash } from './auth/password';
import { env, REPO_ROOT } from './env';

export interface AppConfig {
  isProd: boolean;
  port: number;
  /** scrypt hash of the single user's password */
  adminPasswordHash: string;
  /** e.g. https://ielts.jeemdev.net — used for the same-origin check; derived from the request when empty */
  publicOrigin?: string;
  /** built website (vite build output) */
  webDir: string;
  uploadDir: string;
  sessionDays: number;
}

export async function loadConfig(overrides: Partial<AppConfig> = {}): Promise<AppConfig> {
  const isProd = process.env.NODE_ENV === 'production';
  let adminPasswordHash = overrides.adminPasswordHash ?? process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!isPasswordHash(adminPasswordHash)) {
    if (isProd) throw new Error('ADMIN_PASSWORD_HASH is missing or invalid. Create one with:  node server/dist/hash-password.js "your password"');
    const devPassword = process.env.DEV_PASSWORD || 'ielts-dev';
    adminPasswordHash = await hashPassword(devPassword);
    console.warn(`[dev] ADMIN_PASSWORD_HASH is not set — log in with the development password "${devPassword}"`);
  }
  const publicOrigin = (overrides.publicOrigin ?? process.env.PUBLIC_ORIGIN?.trim()) || undefined;
  return {
    isProd,
    port: Number(process.env.PORT) || 3000,
    adminPasswordHash,
    ...(publicOrigin ? { publicOrigin: publicOrigin.replace(/\/$/, '') } : {}),
    webDir: process.env.WEB_DIR?.trim() || path.join(REPO_ROOT, 'web', 'dist'),
    uploadDir: env.uploadDir,
    sessionDays: Number(process.env.SESSION_DAYS) || 30,
    ...overrides
  };
}
