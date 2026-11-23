import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/client.js';
import type { Database } from '../src/db/client.js';
import { defaultSettings, getSettings } from '../src/modules/admin/service.js';
import { createTestPool } from './helpers/db.js';
import { testConfig } from './helpers/env.js';

/** Q49: Segment 2 reads the settings through `getSettings`; there are no routes yet. */
describe('getSettings (RF25, Q49)', () => {
  const config = testConfig();
  let db: Database;
  let pool: pg.Pool;

  beforeAll(() => {
    db = createDatabase({ url: config.database.url, poolMax: 2 });
    pool = createTestPool();
  });
  afterAll(async () => {
    await db.close();
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM settings');
  });

  it('gives the defaults of the configuration when nothing is stored', async () => {
    expect(await getSettings({ config, db })).toEqual(defaultSettings(config));
  });

  it('gives a stored value in place of the default, and the default for the rest', async () => {
    await pool.query(`INSERT INTO settings (key, value) VALUES ('uploads_per_day', '7'::jsonb)`);
    const settings = await getSettings({ config, db });
    expect(settings.uploads_per_day).toBe(7);
    expect(settings.max_file_size_mb).toBe(defaultSettings(config).max_file_size_mb);
  });

  it('reads the value again on every call: a change applies from the next operation', async () => {
    await pool.query(`INSERT INTO settings (key, value) VALUES ('max_file_size_mb', '5'::jsonb)`);
    expect((await getSettings({ config, db })).max_file_size_mb).toBe(5);
    await pool.query(`UPDATE settings SET value = '9'::jsonb WHERE key = 'max_file_size_mb'`);
    expect((await getSettings({ config, db })).max_file_size_mb).toBe(9);
  });

  it('keeps decimals (the decay factor is 0.8)', async () => {
    await pool.query(`INSERT INTO settings (key, value) VALUES ('mastery_decay', '0.75'::jsonb)`);
    expect((await getSettings({ config, db })).mastery_decay).toBe(0.75);
  });

  it('ignores a key that is not a setting and a value that is not a number', async () => {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('not_a_setting', '1'::jsonb), ('uploads_per_day', '"many"'::jsonb)`,
    );
    const settings = await getSettings({ config, db });
    expect(settings).not.toHaveProperty('not_a_setting');
    expect(settings.uploads_per_day).toBe(defaultSettings(config).uploads_per_day);
  });
});
