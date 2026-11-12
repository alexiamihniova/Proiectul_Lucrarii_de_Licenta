import { migrateDown, migrateUp } from '../../src/db/migrate.js';
import { testDatabaseUrl } from './env.js';

/** Before the suite: rebuild the test database from scratch with the real migrations. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  await migrateDown(url, Number.MAX_SAFE_INTEGER);
  await migrateUp(url);
}
