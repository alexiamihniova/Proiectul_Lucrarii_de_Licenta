import type { FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';

/**
 * Structured logging: one JSON object per line on stdout (pino, bundled with Fastify).
 * Each request gets a `reqId`; use `request.log` in handlers and `app.log` elsewhere so the
 * id is attached automatically. Never log secrets, passwords, tokens or document text.
 *
 * Audit events (SRS 2.4 row 5, 3.6.3) are ordinary log lines carrying `audit: true` plus
 * `action`, `actor_id` and `target` — see `auditLog()`.
 */
export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  if (config.env === 'test') return false;
  return {
    level: config.logLevel,
    base: { service: 'recap-backend' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.password_confirmation',
        '*.token',
      ],
      censor: '[redacted]',
    },
  };
}

export interface AuditEvent {
  /** e.g. `account.deleted`, `settings.updated`, `auth.login_failed` */
  action: string;
  /** User id of whoever did it; `null` for the system or an anonymous visitor. */
  actor_id: number | null;
  target?: Record<string, unknown>;
  result?: 'success' | 'failure';
}

interface MinimalLogger {
  info(obj: object, msg?: string): void;
}

export function auditLog(log: MinimalLogger, event: AuditEvent): void {
  log.info({ audit: true, result: 'success', ...event }, `audit:${event.action}`);
}
