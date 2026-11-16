import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Orm = NodePgDatabase<typeof schema>;

export interface Database {
  pool: pg.Pool;
  orm: Orm;
  close(): Promise<void>;
}

/** The only place a connection pool is created. Repositories receive `Database['orm']`. */
export function createDatabase(options: { url: string; poolMax?: number }): Database {
  const pool = new pg.Pool({ connectionString: options.url, max: options.poolMax ?? 10 });
  const orm = drizzle(pool, { schema, casing: 'snake_case' });
  return { pool, orm, close: () => pool.end() };
}
