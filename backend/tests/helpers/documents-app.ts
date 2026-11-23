import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { buildApp } from '../../src/app.js';
import { actorFromUser } from '../../src/core/actor.js';
import type { UserActor } from '../../src/core/actor.js';
import type { Config } from '../../src/core/config.js';
import type { ErrorCode } from '../../src/core/errors.js';
import { AppError } from '../../src/core/errors.js';
import { createDatabase } from '../../src/db/client.js';
import type { Database } from '../../src/db/client.js';
import type {
  PageCountOutcome,
  PdfPageCounter,
  TextExtractor,
} from '../../src/modules/documents/service.js';
import { FakeLLMClient } from '../../src/modules/llm/service.js';
import { createTestPool } from './db.js';
import { testConfig } from './env.js';
import { multipart, prose, txt } from './fixtures.js';
import type { TestUser } from './session.js';

/** The analysis of Segment 3, replaced by a fake the test controls (design 4.2). */
export interface FakeAnalysis {
  /** Document ids the analysis was called for, in order. */
  calls: number[];
  /** Every later analysis fails with this code (e.g. `LLM_UNAVAILABLE`). */
  failWith(code: ErrorCode): void;
  /** Every later analysis waits until `release()`; it ignores the abort signal unless told. */
  hang(options?: { respectAbort?: boolean }): void;
  /** Back to the default: succeed at once. */
  succeed(): void;
  /** Lets the waiting analyses finish (successfully); later analyses succeed at once. */
  release(): void;
  /** Resolves when an analysis has started and is waiting. */
  started(): Promise<void>;
  /** Whether the signal of the last analysis was aborted. */
  lastSignalAborted(): boolean;
}

export interface DocumentsTestApp {
  app: FastifyInstance;
  db: Database;
  pool: pg.Pool;
  config: Config;
  /** A fresh temporary directory; removed by `close()`. */
  uploadDir: string;
  analysis: FakeAnalysis;
  logs: string[];
  /** Relative paths of every file under the upload directory. */
  storedFiles(): string[];
  close(): Promise<void>;
}

/** The default daily limit is raised so that a test may upload many files as one student. */
const TEST_ENV: NodeJS.ProcessEnv = {
  BCRYPT_COST: '4',
  RATE_LIMIT_AUTH_MAX: '1000000',
  DEFAULT_UPLOADS_PER_DAY: '50',
};

function listFiles(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix)).flatMap((name) => {
    const relative = prefix ? `${prefix}/${name}` : name;
    return statSync(join(root, relative)).isDirectory() ? listFiles(root, relative) : [relative];
  });
}

/**
 * The application with its own upload directory and a fake analysis. Pass environment
 * overrides for other limits (`{ DOCUMENT_PROCESSING_TIMEOUT_SECONDS: '1' }`) and an extractor
 * to replace the reading of files.
 */
export async function buildDocumentsTestApp(
  env: NodeJS.ProcessEnv = {},
  overrides: { textExtractor?: TextExtractor; pdfPageCounter?: PdfPageCounter } = {},
): Promise<DocumentsTestApp> {
  const uploadDir = mkdtempSync(join(tmpdir(), 'recap-uploads-'));
  const config = testConfig({ ...TEST_ENV, UPLOAD_DIR: uploadDir, ...env });
  const db = createDatabase({ url: config.database.url, poolMax: 6 });
  const pool = createTestPool();
  const logs: string[] = [];

  let mode: 'succeed' | 'fail' | 'hang' = 'succeed';
  let failCode: ErrorCode = 'LLM_UNAVAILABLE';
  let respectAbort = false;
  let releases: (() => void)[] = [];
  let startedWaiters: (() => void)[] = [];
  let waiting = 0;
  let lastSignal: AbortSignal | undefined;
  const calls: number[] = [];

  const analysis: FakeAnalysis = {
    calls,
    failWith: (code) => {
      mode = 'fail';
      failCode = code;
    },
    hang: (options = {}) => {
      mode = 'hang';
      respectAbort = options.respectAbort ?? false;
    },
    succeed: () => void (mode = 'succeed'),
    release: () => {
      mode = 'succeed';
      for (const release of releases) release();
      releases = [];
      waiting = 0;
    },
    started: () =>
      waiting > 0 ? Promise.resolve() : new Promise((resolve) => startedWaiters.push(resolve)),
    lastSignalAborted: () => lastSignal?.aborted ?? false,
  };

  const app = await buildApp({
    config,
    db,
    llm: new FakeLLMClient(),
    logStream: { write: (line) => void logs.push(line) },
    ...(overrides.textExtractor ? { textExtractor: overrides.textExtractor } : {}),
    ...(overrides.pdfPageCounter ? { pdfPageCounter: overrides.pdfPageCounter } : {}),
    analyseDocument: async ({ documentId }, signal) => {
      calls.push(documentId);
      lastSignal = signal;
      if (mode === 'fail') throw new AppError(failCode);
      if (mode === 'hang') {
        await new Promise<void>((resolve, reject) => {
          releases.push(resolve);
          if (respectAbort) {
            signal.addEventListener('abort', () =>
              reject(new AppError('DOCUMENT_PROCESSING_TIMEOUT')),
            );
          }
          waiting += 1;
          for (const notify of startedWaiters) notify();
          startedWaiters = [];
        });
      }
    },
  });
  await app.ready();

  return {
    app,
    db,
    pool,
    config,
    uploadDir,
    analysis,
    logs,
    storedFiles: () => listFiles(uploadDir),
    close: async () => {
      analysis.release();
      await app.close();
      await db.close();
      await pool.end();
      rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

export const actorOf = (user: TestUser): UserActor =>
  actorFromUser({ id: user.id, role: 'student' });

let subjectCounter = 0;

/** Creates a subject through the API and returns its id. */
export async function createSubject(
  app: FastifyInstance,
  user: TestUser,
  name?: string,
): Promise<number> {
  subjectCounter += 1;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/subjects',
    headers: user.headers,
    payload: { name: name ?? `Materia ${subjectCounter} ${Date.now()}` },
  });
  if (response.statusCode !== 201) {
    throw new Error(`creating a subject failed with ${response.statusCode}: ${response.body}`);
  }
  return (response.json() as { id: number }).id;
}

/** Uploads a file through the API (UC-04) and returns the raw response. */
export function uploadRequest(
  app: FastifyInstance,
  user: TestUser,
  subjectId: number,
  file: { fileName: string; content: Buffer; contentType?: string },
  fieldName = 'file',
): Promise<LightMyRequestResponse> {
  const body = multipart(file, fieldName);
  return app.inject({
    method: 'POST',
    url: `/api/v1/subjects/${subjectId}/documents`,
    headers: { ...user.headers, ...body.headers },
    payload: body.payload,
  });
}

/** A text file long enough to become several passages: about 720 words. */
export const SAMPLE_TEXT = prose(12, 5, 12);

/** Uploads a file (by default a valid .txt) and returns the document id. */
export async function upload(
  app: FastifyInstance,
  user: TestUser,
  subjectId: number,
  file: { fileName: string; content: Buffer } = { fileName: 'curs.txt', content: txt(SAMPLE_TEXT) },
): Promise<number> {
  const response = await uploadRequest(app, user, subjectId, file);
  if (response.statusCode !== 201) {
    throw new Error(`upload failed with ${response.statusCode}: ${response.body}`);
  }
  return (response.json() as { id: number }).id;
}

/** Runs the worker step until the queue is empty; returns how many documents it processed. */
export async function processQueue(app: FastifyInstance): Promise<number> {
  let processed = 0;
  while (await app.documents.processNextDocument()) processed += 1;
  return processed;
}

/** Uploads a valid file and processes it: the document is `ready`. Returns its id. */
export async function readyDocument(
  ctx: DocumentsTestApp,
  user: TestUser,
  subjectId: number,
  file?: { fileName: string; content: Buffer },
): Promise<number> {
  const documentId = await upload(ctx.app, user, subjectId, file);
  await processQueue(ctx.app);
  return documentId;
}

export async function documentRow(pool: pg.Pool, documentId: number) {
  const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [documentId]);
  return rows[0] as
    | {
        id: string;
        subject_id: string;
        file_name: string;
        format: string;
        size_bytes: string;
        page_count: number | null;
        status: string;
        error_reason: string | null;
        uploaded_at: Date;
        processing_started_at: Date | null;
        deleted_at: Date | null;
      }
    | undefined;
}

export function getDocument(app: FastifyInstance, user: TestUser, documentId: number) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/documents/${documentId}`,
    headers: user.headers,
  });
}

/** Changes an administrator setting directly (the routes are Segment 7's). */
export async function setSetting(pool: pg.Pool, key: string, value: number): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}

/** Removes a setting, so that the default of the configuration applies again. */
export async function clearSetting(pool: pg.Pool, key: string): Promise<void> {
  await pool.query('DELETE FROM settings WHERE key = $1', [key]);
}

/**
 * Makes a deleted document look older. The database refuses any change to a deleted row
 * (the state trigger), so the trigger is switched off for this one statement.
 */
export async function backdateDeletedDocument(
  pool: pg.Pool,
  documentId: number,
  hoursSinceDeleted: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE documents DISABLE TRIGGER documents_enforce_status_transition');
    await client.query(
      `UPDATE documents
       SET uploaded_at = now() - ($2 || ' hours')::interval - interval '1 hour',
           deleted_at = now() - ($2 || ' hours')::interval
       WHERE id = $1`,
      [documentId, String(hoursSinceDeleted)],
    );
    await client.query('ALTER TABLE documents ENABLE TRIGGER documents_enforce_status_transition');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** A page counter that answers what the test says and records how it was called (Q48). */
export interface FakePageCounter extends PdfPageCounter {
  calls: { content: Buffer; limits: { timeoutMs: number; maxMemoryMb: number } }[];
}

export function fakePageCounter(
  answer: PageCountOutcome | (() => PageCountOutcome | Promise<PageCountOutcome>),
): FakePageCounter {
  const calls: FakePageCounter['calls'] = [];
  return {
    calls,
    count: async (content, limits) => {
      calls.push({ content, limits });
      return typeof answer === 'function' ? answer() : answer;
    },
  };
}
