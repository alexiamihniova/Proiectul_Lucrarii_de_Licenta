import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import type { Database } from '../../src/db/client.js';
import { testConfig } from './env.js';

export async function buildTestApp(): Promise<{ app: FastifyInstance; db: Database }> {
  const config = testConfig();
  const db = createDatabase({ url: config.database.url, poolMax: 2 });
  const app = await buildApp({ config, db });
  await app.ready();
  return { app, db };
}
