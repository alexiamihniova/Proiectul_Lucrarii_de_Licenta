import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadEnvFile } from './core/config.js';
import { createDatabase } from './db/client.js';

/** HTTP entry point: `npm run dev` / `npm start`. */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const db = createDatabase({ url: config.database.url, poolMax: config.database.poolMax });
  const app = await buildApp({ config, db });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error: unknown) => {
  // The logger may not exist yet (e.g. invalid configuration), so write one JSON line by hand.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'startup failed', error: message, config_error: error instanceof ConfigError })}\n`,
  );
  process.exit(1);
});
