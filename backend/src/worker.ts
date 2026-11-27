import { pino } from 'pino';
import type { Logger } from 'pino';
import { ConfigError, loadConfig, loadEnvFile } from './core/config.js';
import type { Config } from './core/config.js';
import type { WorkerTask } from './core/worker.js';
import { assertPollInterval, startWorker } from './core/worker.js';
import { createDatabase } from './db/client.js';
import type { Database } from './db/client.js';
import { authWorkerTasks, createAuthService } from './modules/auth/service.js';
import { createDocumentsService, documentsWorkerTasks } from './modules/documents/service.js';
import { createPasswordResetSender } from './modules/reminders/service.js';

/**
 * Background worker entry point: `npm run dev:worker` / `npm run start:worker`.
 * Segments register their tasks in `collectTasks()` by calling a function exported from
 * their module's `service.ts`.
 */
function collectTasks(deps: { config: Config; db: Database; log: Logger }): WorkerTask[] {
  // ONE documents service for the whole process: auth needs its file store, and the queue its tasks.
  // No `analyseDocument` is given until Segment 3: a document becomes ready with its text and its
  // passages, and without concepts (Q52).
  const documents = createDocumentsService(deps);
  const auth = createAuthService({
    ...deps,
    sendPasswordResetEmail: createPasswordResetSender(deps),
    userFiles: documents.userFiles,
  });
  return [
    ...authWorkerTasks(auth),
    ...documentsWorkerTasks(documents, { pollIntervalMs: deps.config.worker.pollIntervalMs }),
    // Segment 7:   ...adminWorkerTasks(deps)
    // Segment 8:   ...remindersWorkerTasks(deps)
  ];
}

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  assertPollInterval(config.worker.pollIntervalMs); // before anything is opened
  const log = pino({ level: config.logLevel, base: { service: 'recap-worker' } });
  const db = createDatabase({ url: config.database.url, poolMax: config.database.poolMax });
  await db.pool.query('SELECT 1');

  log.warn(
    'document analysis: no concept extraction yet (Segment 3); documents become ready with their text and passages, without concepts',
  );
  const worker = startWorker(collectTasks({ config, db, log }), log);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    await worker.stop();
    await db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'worker startup failed', error: message, config_error: error instanceof ConfigError })}\n`,
  );
  process.exit(1);
});
