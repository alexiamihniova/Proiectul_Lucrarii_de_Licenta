import { pino } from 'pino';
import { ConfigError, loadConfig, loadEnvFile } from './core/config.js';
import type { WorkerTask } from './core/worker.js';
import { startWorker } from './core/worker.js';
import { createDatabase } from './db/client.js';

/**
 * Background worker entry point: `npm run dev:worker` / `npm run start:worker`.
 * Segments register their tasks in `collectTasks()` by calling a function exported from
 * their module's `service.ts`, e.g. `documentsWorkerTasks({ config, db, log })`.
 */
function collectTasks(): WorkerTask[] {
  return [
    // Segment 2/3: ...documentsWorkerTasks(deps)
    // Segment 7:   ...adminWorkerTasks(deps)
    // Segment 8:   ...remindersWorkerTasks(deps)
  ];
}

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const log = pino({ level: config.logLevel, base: { service: 'recap-worker' } });
  const db = createDatabase({ url: config.database.url, poolMax: config.database.poolMax });
  await db.pool.query('SELECT 1');

  const worker = startWorker(collectTasks(), log);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    await worker.stop();
    await db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep the process alive even when no task is registered yet.
  setInterval(() => undefined, 60_000);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'worker startup failed', error: message, config_error: error instanceof ConfigError })}\n`,
  );
  process.exit(1);
});
