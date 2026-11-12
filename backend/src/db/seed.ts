import { sql } from 'drizzle-orm';
import { loadConfig, loadEnvFile } from '../core/config.js';
import { defaultSettings } from '../modules/admin/service.js';
import { createDatabase } from './client.js';
import { settings } from './schema/index.js';

/**
 * Idempotent seed: inserts the default settings that are missing. Never overwrites a value an
 * administrator changed. The initial administrator account is created by Segment 1.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const db = createDatabase({ url: config.database.url, poolMax: 1 });
  try {
    const rows = Object.entries(defaultSettings(config)).map(([key, value]) => ({ key, value }));
    const inserted = await db.orm
      .insert(settings)
      .values(rows)
      .onConflictDoNothing({ target: settings.key })
      .returning({ key: settings.key });
    const total = await db.orm.select({ count: sql<number>`count(*)::int` }).from(settings);
    process.stdout.write(`settings: inserted ${inserted.length}, total ${total[0]?.count ?? 0}\n`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
