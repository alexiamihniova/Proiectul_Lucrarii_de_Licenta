import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDatabase } from '../src/db/client.js';
import type { Database } from '../src/db/client.js';
import { buildTestApp } from './helpers/app.js';
import { testConfig } from './helpers/env.js';

describe('health endpoint', () => {
  let app: FastifyInstance;
  let db: Database;

  beforeAll(async () => {
    ({ app, db } = await buildTestApp());
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it.each(['/health', '/api/v1/health'])(
    'GET %s answers 200 when the database is reachable',
    async (url) => {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok', database: 'connected' });
      expect(response.json().uptime_seconds).toBeGreaterThanOrEqual(0);
    },
  );

  it('answers 503 when the database is unreachable', async () => {
    const config = testConfig();
    const deadDb = createDatabase({ url: 'postgres://127.0.0.1:1/none', poolMax: 1 });
    const deadApp = await buildApp({ config, db: deadDb });
    const response = await deadApp.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: 'error', database: 'unreachable' });
    await deadApp.close();
    await deadDb.close();
  });
});
