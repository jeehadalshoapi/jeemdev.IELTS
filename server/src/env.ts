import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

// load .env from the repo root when it exists (never committed — see .env.example)
const envFile = path.join(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const env = {
  /** PostgreSQL connection string. When empty, a local PGlite database is used (development only). */
  databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
  pgliteDir: process.env.PGLITE_DIR?.trim() || path.join(REPO_ROOT, '.data', 'pglite'),
  uploadDir: process.env.UPLOAD_DIR?.trim() || path.join(REPO_ROOT, '.data', 'uploads')
};
