import type { Config } from '../../core/config.js';
import type { SettingKey } from '../../core/domain.js';
import type { Database } from '../../db/client.js';
import { readStoredSettings } from './repository.js';

/**
 * Public surface of the admin module (Segment 7). Other modules import ONLY from this file.
 *
 * Segment 7 implements here: account management (through the auth service), usage statistics,
 * the model call journal and its aggregates (through the llm service), reported materials
 * (through the content service), settings with range validation and audit logging, the
 * retention task for `llm_calls`.
 *
 * Expected exports for other modules: `getSettings()` — THE way any module reads a limit or a
 * threshold (RF25: a change applies from the next operation, so values are never cached for
 * longer than one request); `adminWorkerTasks` (src/worker.ts).
 */

/** Values written by `npm run db:seed` on a fresh database (SRS 2.1.8, 3.2.4.2). */
export function defaultSettings(config: Config): Record<SettingKey, number> {
  return {
    max_file_size_mb: config.upload.defaultMaxFileSizeMb,
    uploads_per_day: config.upload.defaultUploadsPerDay,
    mastery_threshold_low: 50,
    mastery_threshold_high: 80,
    mastery_window: 10,
    mastery_decay: 0.8,
    monthly_cost_limit: 10,
  };
}

/**
 * THE way any module reads a limit or a threshold (RF25): the stored value of each setting, or
 * its default when the row is missing. Nothing is cached, so a change made by an administrator
 * applies from the next call. Read only: validating, changing and auditing settings is Segment
 * 7's, and there are no routes for it yet (Q49).
 */
export async function getSettings(deps: {
  config: Config;
  db: Database;
}): Promise<Record<SettingKey, number>> {
  const stored = await readStoredSettings(deps.db);
  return { ...defaultSettings(deps.config), ...stored };
}
