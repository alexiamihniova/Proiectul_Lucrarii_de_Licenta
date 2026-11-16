import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listMigrations, migrateDown, migrateUp, migrationStatus } from '../src/db/migrate.js';
import { TABLES, createTestPool } from './helpers/db.js';
import { testDatabaseUrl } from './helpers/env.js';

const url = testDatabaseUrl();
const pool = createTestPool();
const ALL = Number.MAX_SAFE_INTEGER;

async function publicTables(): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function leftovers(): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public')
          + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'S') AS n`,
  );
  return Number(result.rows[0]!.n);
}

describe('migrations', () => {
  afterAll(async () => {
    await migrateUp(url); // leave the schema in place for the other test files
    await pool.end();
  });

  it('every migration has a down file', () => {
    for (const tag of listMigrations()) {
      expect(existsSync(resolve('drizzle', 'down', `${tag}.sql`)), `drizzle/down/${tag}.sql`).toBe(
        true,
      );
    }
  });

  it('applies on an empty database and creates exactly the 16 tables', async () => {
    await migrateDown(url, ALL);
    expect(await publicTables()).toEqual([]);

    const applied = await migrateUp(url);
    expect(applied).toEqual(listMigrations());
    expect(await publicTables()).toEqual([...TABLES].sort());
    expect(TABLES).toHaveLength(16);
  });

  it('is idempotent: a second run applies nothing', async () => {
    expect(await migrateUp(url)).toEqual([]);
    expect((await migrationStatus(url)).every((row) => row.applied)).toBe(true);
  });

  it('can be reverted completely, leaving no table, function or sequence behind', async () => {
    const reverted = await migrateDown(url, ALL);
    expect(reverted).toEqual([...listMigrations()].reverse());
    expect(await publicTables()).toEqual([]);
    expect(await leftovers()).toBe(0);
  });

  it('can be applied again after being reverted', async () => {
    await migrateUp(url);
    expect(await publicTables()).toEqual([...TABLES].sort());
  });

  it('reverts one migration at a time by default', async () => {
    const reverted = await migrateDown(url);
    expect(reverted).toEqual(listMigrations().slice(-1));
    await migrateUp(url);
  });
});
