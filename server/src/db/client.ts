import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { env, SERVER_ROOT } from '../env';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: Db;
  /** "postgres" on the server, "pglite" for local development and tests */
  kind: 'postgres' | 'pglite';
  migrate(): Promise<void>;
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
      close: () => pool.end()
    };
  }
  const dir = opts.pgliteDir ?? env.pgliteDir;
  if (!dir.startsWith('memory://')) mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  const db = drizzlePglite({ client, schema });
  return {
    db: db as unknown as Db,
    kind: 'pglite',
    migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.close()
  };
}
