import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Application configuration. Every value comes from environment variables (see `.env.example`
 * in the repository root) and is validated once, at startup. The process refuses to start when
 * a required value is missing or malformed.
 *
 * Runtime-tunable limits (RF25) live in the `settings` table; the DEFAULT_* variables below are
 * only the values used by `npm run db:seed` on a fresh database.
 */

const emptyToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: int(1, 65535).default(3001),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    APP_BASE_URL: z.url().default('http://localhost:5173'),
    APP_TIMEZONE: z.string().default('Europe/Chisinau'),

    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string'),
    DATABASE_POOL_MAX: int(1, 100).default(10),

    SESSION_SECRET: z
      .string({ error: 'SESSION_SECRET is required' })
      .min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_HOURS: int(1, 24).default(24),
    SESSION_COOKIE_NAME: z.string().min(1).default('recap_session'),

    // Accounts (docs/design/auth.md, section 0). SRS values are the defaults.
    BCRYPT_COST: int(4, 15).default(12),
    AUTH_MAX_FAILED_ATTEMPTS: int(1, 20).default(5),
    AUTH_LOCK_MINUTES: int(1, 1440).default(15),
    PASSWORD_RESET_TTL_MINUTES: int(5, 1440).default(60),
    PASSWORD_RESET_MAX_PER_HOUR: int(1, 100).default(3),
    RATE_LIMIT_AUTH_MAX: int(1, 1_000_000).default(20),
    RATE_LIMIT_AUTH_WINDOW_SECONDS: int(1, 3600).default(60),
    TRUST_PROXY: bool.default(false),

    LLM_PROVIDER: z.string().min(1).default('fake'),
    LLM_MODEL: optionalString,
    LLM_API_KEY: optionalString,
    LLM_BASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),

    SMTP_HOST: z.string({ error: 'SMTP_HOST is required' }).min(1),
    SMTP_PORT: int(1, 65535).default(587),
    SMTP_SECURE: bool.default(true),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: z.string({ error: 'SMTP_FROM is required' }).min(3),

    UPLOAD_DIR: z.string().min(1).default('./storage/uploads'),
    UPLOAD_HARD_LIMIT_MB: int(1, 50).default(50),
    UPLOAD_MAX_PAGES: int(1, 1000).default(100),
    DEFAULT_MAX_FILE_SIZE_MB: int(1, 50).default(20),
    DEFAULT_UPLOADS_PER_DAY: int(1, 50).default(10),
    DOCUMENT_PROCESSING_TIMEOUT_SECONDS: int(1, 600).default(60),
    PDF_PAGE_COUNT_TIMEOUT_SECONDS: int(1, 60).default(5),
    PDF_PAGE_COUNT_MEMORY_MB: int(64, 2048).default(256),
    DELETED_DOCUMENT_RETENTION_HOURS: int(1, 720).default(48),

    WORKER_POLL_INTERVAL_MS: int(100, 60_000).default(1000),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER !== 'fake') {
      if (!env.LLM_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['LLM_API_KEY'],
          message: 'LLM_API_KEY is required unless LLM_PROVIDER=fake',
        });
      }
      if (!env.LLM_MODEL) {
        ctx.addIssue({
          code: 'custom',
          path: ['LLM_MODEL'],
          message: 'LLM_MODEL is required unless LLM_PROVIDER=fake',
        });
      }
    }
    if (env.NODE_ENV === 'production' && env.LLM_PROVIDER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'LLM_PROVIDER=fake is not allowed in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.BCRYPT_COST < 10) {
      ctx.addIssue({
        code: 'custom',
        path: ['BCRYPT_COST'],
        message: 'BCRYPT_COST must be at least 10 in production',
      });
    }
    if (env.DEFAULT_MAX_FILE_SIZE_MB > env.UPLOAD_HARD_LIMIT_MB) {
      ctx.addIssue({
        code: 'custom',
        path: ['DEFAULT_MAX_FILE_SIZE_MB'],
        message: 'DEFAULT_MAX_FILE_SIZE_MB cannot exceed UPLOAD_HARD_LIMIT_MB',
      });
    }
  });

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: string;
  appBaseUrl: string;
  timezone: string;
  database: { url: string; poolMax: number };
  session: { secret: string; ttlHours: number; cookieName: string };
  auth: {
    bcryptCost: number;
    maxFailedAttempts: number;
    lockMinutes: number;
    resetTtlMinutes: number;
    resetRequestsPerHour: number;
    /** Per-IP limit on the public account routes. */
    rateLimit: { max: number; windowSeconds: number };
  };
  /** Use X-Forwarded-For for the client address (only behind a trusted reverse proxy). */
  trustProxy: boolean;
  llm: { provider: string; model?: string; apiKey?: string; baseUrl?: string };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
  };
  upload: {
    dir: string;
    hardLimitMb: number;
    maxPages: number;
    defaultMaxFileSizeMb: number;
    defaultUploadsPerDay: number;
  };
  documents: {
    /** T2, event PE: a document still `processing` after this long becomes `error`. */
    processingTimeoutSeconds: number;
    /** Q48: counting the pages of a PDF at upload is stopped after this long (provisional). */
    pageCountTimeoutSeconds: number;
    /** Q48: and when the counting thread needs more memory than this (provisional). */
    pageCountMemoryMb: number;
    /** Q12: soft-deleted rows are removed for good after this long. */
    deletedRetentionHours: number;
  };
  worker: { pollIntervalMs: number };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    appBaseUrl: e.APP_BASE_URL,
    timezone: e.APP_TIMEZONE,
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    session: {
      secret: e.SESSION_SECRET,
      ttlHours: e.SESSION_TTL_HOURS,
      cookieName: e.SESSION_COOKIE_NAME,
    },
    llm: {
      provider: e.LLM_PROVIDER,
      model: e.LLM_MODEL,
      apiKey: e.LLM_API_KEY,
      baseUrl: e.LLM_BASE_URL,
    },
    smtp: {
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_SECURE,
      user: e.SMTP_USER,
      password: e.SMTP_PASSWORD,
      from: e.SMTP_FROM,
    },
    upload: {
      dir: e.UPLOAD_DIR,
      hardLimitMb: e.UPLOAD_HARD_LIMIT_MB,
      maxPages: e.UPLOAD_MAX_PAGES,
      defaultMaxFileSizeMb: e.DEFAULT_MAX_FILE_SIZE_MB,
      defaultUploadsPerDay: e.DEFAULT_UPLOADS_PER_DAY,
    },
    documents: {
      processingTimeoutSeconds: e.DOCUMENT_PROCESSING_TIMEOUT_SECONDS,
      pageCountTimeoutSeconds: e.PDF_PAGE_COUNT_TIMEOUT_SECONDS,
      pageCountMemoryMb: e.PDF_PAGE_COUNT_MEMORY_MB,
      deletedRetentionHours: e.DELETED_DOCUMENT_RETENTION_HOURS,
    },
    auth: {
      bcryptCost: e.BCRYPT_COST,
      maxFailedAttempts: e.AUTH_MAX_FAILED_ATTEMPTS,
      lockMinutes: e.AUTH_LOCK_MINUTES,
      resetTtlMinutes: e.PASSWORD_RESET_TTL_MINUTES,
      resetRequestsPerHour: e.PASSWORD_RESET_MAX_PER_HOUR,
      rateLimit: { max: e.RATE_LIMIT_AUTH_MAX, windowSeconds: e.RATE_LIMIT_AUTH_WINDOW_SECONDS },
    },
    trustProxy: e.TRUST_PROXY,
    worker: { pollIntervalMs: e.WORKER_POLL_INTERVAL_MS },
  };
}

/**
 * Loads the repository-root `.env` (or `backend/.env`) into `process.env` for local runs.
 * Variables that are already set win, so Docker/CI configuration is never overridden.
 * Entry points call this before `loadConfig()`; library code never reads `process.env`.
 */
export function loadEnvFile(cwd: string = process.cwd()): string | null {
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '..', '.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return candidate;
    }
  }
  return null;
}
