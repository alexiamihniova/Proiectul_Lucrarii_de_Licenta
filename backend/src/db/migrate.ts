import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

/**
 * Migration runner (ADR-0002).
 *
 *  - `drizzle-kit generate` writes `drizzle/<tag>.sql` and records the order in
 *    `drizzle/meta/_journal.json`.
 *  - Every migration has a hand-written inverse in `drizzle/down/<tag>.sql`
 *    (drizzle-kit does not generate down migrations).
 *  - Applied migrations are recorded in the `schema_migrations` table.
 *  - Each migration runs in its own transaction; a session advisory lock prevents two
 *    processes from migrating at once.
 *
 * CLI: `tsx src/db/migrate.ts up` | `down [count]` | `down --all` | `status`
 */

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');
const LOCK_KEY = 7_203_001;

interface JournalEntry {
  idx: number;
  tag: string;
}

export function listMigrations(dir: string = MIGRATIONS_DIR): string[] {
  const journal = JSON.parse(readFileSync(resolve(dir, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
}

function readSql(dir: string, direction: 'up' | 'down', tag: string): string {
  const path = direction === 'up' ? resolve(dir, `${tag}.sql`) : resolve(dir, 'down', `${tag}.sql`);
  if (!existsSync(path)) throw new Error(`Missing ${direction} migration file: ${path}`);
  return readFileSync(path, 'utf8').replaceAll('--> statement-breakpoint', '');
}

async function withClient<T>(
  databaseUrl: string,
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         tag text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    return await run(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    await client.end();
  }
}

async function appliedTags(client: pg.Client): Promise<Set<string>> {
  const result = await client.query<{ tag: string }>('SELECT tag FROM schema_migrations');
  return new Set(result.rows.map((row) => row.tag));
}

async function inTransaction(client: pg.Client, run: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await run();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Applies every pending migration. Returns the tags it applied. */
export async function migrateUp(databaseUrl: string, dir = MIGRATIONS_DIR): Promise<string[]> {
  return withClient(databaseUrl, async (client) => {
    const applied = await appliedTags(client);
    const done: string[] = [];
    for (const tag of listMigrations(dir)) {
      if (applied.has(tag)) continue;
      await inTransaction(client, async () => {
        await client.query(readSql(dir, 'up', tag));
        await client.query('INSERT INTO schema_migrations (tag) VALUES ($1)', [tag]);
      });
      done.push(tag);
    }
    return done;
  });
}

/** Reverts the last `count` applied migrations (default 1). Returns the tags it reverted. */
export async function migrateDown(
  databaseUrl: string,
  count: number = 1,
  dir = MIGRATIONS_DIR,
): Promise<string[]> {
  return withClient(databaseUrl, async (client) => {
    const applied = await appliedTags(client);
    const toRevert = listMigrations(dir)
      .filter((tag) => applied.has(tag))
      .reverse()
      .slice(0, count);
    for (const tag of toRevert) {
      await inTransaction(client, async () => {
        await client.query(readSql(dir, 'down', tag));
        await client.query('DELETE FROM schema_migrations WHERE tag = $1', [tag]);
      });
    }
    return toRevert;
  });
}

export async function migrationStatus(
  databaseUrl: string,
  dir = MIGRATIONS_DIR,
): Promise<{ tag: string; applied: boolean }[]> {
  return withClient(databaseUrl, async (client) => {
    const applied = await appliedTags(client);
    return listMigrations(dir).map((tag) => ({ tag, applied: applied.has(tag) }));
  });
}

async function cli(): Promise<void> {
  const { loadEnvFile } = await import('../core/config.js');
  loadEnvFile();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const [command = 'up', argument] = process.argv.slice(2);
  const print = (line: string) => process.stdout.write(`${line}\n`);

  if (command === 'up') {
    const done = await migrateUp(databaseUrl);
    print(done.length ? `applied: ${done.join(', ')}` : 'nothing to apply');
  } else if (command === 'down') {
    const count = argument === '--all' ? Number.MAX_SAFE_INTEGER : Number(argument ?? 1);
    if (!Number.isInteger(count) || count < 1) throw new Error('usage: down [count|--all]');
    const done = await migrateDown(databaseUrl, count);
    print(done.length ? `reverted: ${done.join(', ')}` : 'nothing to revert');
  } else if (command === 'status') {
    for (const row of await migrationStatus(databaseUrl)) {
      print(`${row.applied ? '[x]' : '[ ]'} ${row.tag}`);
    }
  } else {
    throw new Error(`unknown command "${command}" (use: up | down [count|--all] | status)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch((error: unknown) => {
    process.stderr.write(
      `migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
