import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../../src/app.js';
import type { Config } from '../../src/core/config.js';
import { createDatabase } from '../../src/db/client.js';
import type { Database } from '../../src/db/client.js';
import type { PasswordResetEmail } from '../../src/modules/auth/service.js';
import { FakeLLMClient } from '../../src/modules/llm/service.js';
import { createTestPool } from './db.js';
import { testConfig } from './env.js';

export interface AuthTestApp {
  app: FastifyInstance;
  db: Database;
  pool: pg.Pool;
  config: Config;
  /** Every reset e-mail the application tried to send, oldest first. */
  mail: PasswordResetEmail[];
  /** Make the next reset e-mail fail, to test that the request still answers 202. */
  failNextMail(): void;
  /** One entry per call to `userFiles.deleteAllForUser`. */
  fileDeletions: { userId: number; userStillInDatabase: boolean }[];
  /** Make the next file deletion fail. */
  failNextFileDeletion(): void;
  /** Every log line written by the application, as text. */
  logs: string[];
  /** Parsed log lines that are audit events. */
  auditEvents(): Record<string, unknown>[];
  close(): Promise<void>;
}

/** Test defaults: fast bcrypt, and a per-IP limit high enough never to interfere. */
const TEST_ENV: NodeJS.ProcessEnv = { BCRYPT_COST: '4', RATE_LIMIT_AUTH_MAX: '1000000' };

export const PRODUCTION_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  BCRYPT_COST: '10',
  LLM_PROVIDER: 'real',
  LLM_API_KEY: 'unused',
  LLM_MODEL: 'unused',
};

/**
 * The application with the outside world replaced by recorders: reset e-mails, file deletion
 * and the log. Pass environment overrides to test other limits (`{ AUTH_LOCK_MINUTES: '1' }`).
 */
export async function buildAuthTestApp(env: NodeJS.ProcessEnv = {}): Promise<AuthTestApp> {
  const config = testConfig({ ...TEST_ENV, ...env });
  const db = createDatabase({ url: config.database.url, poolMax: 4 });
  const pool = createTestPool();
  const mail: PasswordResetEmail[] = [];
  const fileDeletions: AuthTestApp['fileDeletions'] = [];
  const logs: string[] = [];
  let mailFails = false;
  let filesFail = false;

  const app = await buildApp({
    config,
    db,
    llm: new FakeLLMClient(),
    logStream: { write: (line) => void logs.push(line) },
    sendPasswordResetEmail: async (message) => {
      if (mailFails) {
        mailFails = false;
        throw new Error('smtp down');
      }
      mail.push(message);
    },
    userFiles: {
      deleteAllForUser: async (userId) => {
        const { rows } = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
        fileDeletions.push({ userId, userStillInDatabase: rows.length > 0 });
        if (filesFail) {
          filesFail = false;
          throw new Error('disk error');
        }
      },
    },
  });
  await app.ready();

  return {
    app,
    db,
    pool,
    config,
    mail,
    failNextMail: () => void (mailFails = true),
    fileDeletions,
    failNextFileDeletion: () => void (filesFail = true),
    logs,
    auditEvents: () =>
      logs
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as Record<string, unknown>];
          } catch {
            return [];
          }
        })
        .filter((entry) => entry.audit === true),
    close: async () => {
      await app.close();
      await db.close();
      await pool.end();
    },
  };
}

/** Asserts the single error format and returns the error object. */
export function errorOf(response: { json(): unknown }) {
  return (response.json() as { error: { code: string; message: string; details?: unknown } }).error;
}
