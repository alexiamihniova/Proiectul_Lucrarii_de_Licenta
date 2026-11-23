import { inArray } from 'drizzle-orm';
import { SETTING_KEYS } from '../../core/domain.js';
import type { SettingKey } from '../../core/domain.js';
import type { Database } from '../../db/client.js';
import { settings } from '../../db/schema/index.js';

/** Segment 7: queries on `settings`; read-only aggregates for statistics. */

/**
 * The stored values of the known settings, as numbers. A key that is missing, or whose stored
 * value is not a finite number, is left out: the caller falls back to the default.
 */
export async function readStoredSettings(
  db: Database,
): Promise<Partial<Record<SettingKey, number>>> {
  const rows = await db.orm
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...SETTING_KEYS]));
  const stored: Partial<Record<SettingKey, number>> = {};
  for (const row of rows) {
    if (typeof row.value === 'number' && Number.isFinite(row.value)) {
      stored[row.key as SettingKey] = row.value;
    }
  }
  return stored;
}
