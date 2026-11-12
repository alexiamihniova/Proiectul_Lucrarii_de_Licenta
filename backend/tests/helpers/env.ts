import { loadConfig, loadEnvFile } from '../../src/core/config.js';
import type { Config } from '../../src/core/config.js';

/** Minimal valid environment; tests add or remove keys from a copy of it. */
export const VALID_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost:5432/recap_test',
  SESSION_SECRET: 'test-secret-test-secret-test-secret-0123',
  SMTP_HOST: 'localhost',
  SMTP_FROM: 'Recap <no-reply@localhost>',
} as const satisfies NodeJS.ProcessEnv;

/**
 * The database the suite may destroy. Taken from TEST_DATABASE_URL (environment or `.env`).
 * Refuses any database whose name does not contain "test", so a wrong variable can never
 * wipe development data.
 */
export function testDatabaseUrl(): string {
  loadEnvFile();
  const url = process.env.TEST_DATABASE_URL ?? VALID_ENV.DATABASE_URL;
  const name = new URL(url).pathname.slice(1);
  if (!name.includes('test')) {
    throw new Error(`TEST_DATABASE_URL must point to a database named "*test*", got "${name}"`);
  }
  return url;
}

export function testConfig(overrides: NodeJS.ProcessEnv = {}): Config {
  return loadConfig({ ...VALID_ENV, DATABASE_URL: testDatabaseUrl(), ...overrides });
}
