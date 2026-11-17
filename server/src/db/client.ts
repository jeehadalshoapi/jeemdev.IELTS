import path from 'node:path';
import { mkdirSync } from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { env, SERVER_ROOT } from '../env';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** "postgres" on the server, "pglite" for local development and tests */
  kind: 'postgres' | 'pglite';
  migrate(): Promise<void>;
  /** quick connectivity check for /health */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = path.join(SERVER_ROOT, 'drizzle');

/**
 * Open the database.
 * - DATABASE_URL set  -> PostgreSQL (production, Docker on the VPS)
 * - otherwise         -> PGlite in .data/pglite (development); pass pgliteDir "memory://" for tests
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string } = {}): Promise<Database> {
  const url = opts.url ?? (opts.pgliteDir ? undefined : env.databaseUrl);
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzlePg({ client: pool, schema });
    return {
      db: db as unknown as Db,
      kind: 'postgres',
      migrate: () => migratePg(db, { migrationsFolder: MIGRATIONS_DIR }),
      ping: async () => { try { await pool.query('select 1'); return true; } catch { return false; } },
      close: () => pool.end()
    };
  }
  // PGlite is a development dependency only — loaded on demand so production never needs it
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite');
  const { migrate: migratePglite } = await import('drizzle-orm/pglite/migrator');
  const dir = opts.pgliteDir ?? env.pgliteDir;
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const db = drizzlePglite({ client, schema });
  return {
    db: db as unknown as Db,
    kind: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
    ping: async () => { try { await client.query('select 1'); return true; } catch { return false; } },
    close: () => client.close()
  };
}
