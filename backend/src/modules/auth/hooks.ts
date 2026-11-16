import type { FastifyInstance } from 'fastify';
import { actorFromUser } from '../../core/actor.js';
import { errorBody } from '../../core/errors.js';
import { auditLog } from '../../core/logger.js';
import { clearedSessionCookie, readSessionCookie } from './cookies.js';
import type { AuthService } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** When the current session ends; `null` on public routes. Read by `GET /auth/me`. */
    sessionExpiresAt: Date | null;
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** The public account routes that share the per-IP limit (design 3.3). */
const RATE_LIMITED_ROUTES = [
  '/auth/register',
  '/auth/login',
  '/auth/password-reset/request',
  '/auth/password-reset/confirm',
  '/reminders/unsubscribe',
];

/** Above this many tracked addresses, windows that have ended are dropped. */
const RATE_LIMIT_SWEEP_SIZE = 10_000;

interface Window {
  startedAt: number;
  count: number;
}

/**
 * The one `onRequest` hook of design 6.1, in this order: origin check → per-IP rate limit on
 * the public account routes → session → role. It runs before body validation, so a visitor
 * without a session gets `401`, never validation details.
 */
export function registerAuthHooks(app: FastifyInstance, service: AuthService): void {
  const config = app.config;
  const allowedOrigin = new URL(config.appBaseUrl).origin;
  const windowMs = config.auth.rateLimit.windowSeconds * 1000;
  // Belongs to this application instance, so that tests can build apps with other limits.
  const windows = new Map<string, Window>();

  /** Seconds to wait when the address is over the limit, otherwise `null` (and it is counted). */
  function countRequest(ip: string, nowMs: number): number | null {
    const window = windows.get(ip);
    if (!window || nowMs - window.startedAt >= windowMs) {
      if (windows.size >= RATE_LIMIT_SWEEP_SIZE) {
        for (const [key, value] of windows) {
          if (nowMs - value.startedAt >= windowMs) windows.delete(key);
        }
      }
      windows.set(ip, { startedAt: nowMs, count: 1 });
      return null;
    }
    if (window.count >= config.auth.rateLimit.max) {
      return Math.max(1, Math.ceil((window.startedAt + windowMs - nowMs) / 1000));
    }
    window.count += 1;
    return null;
  }

  app.decorateRequest('user', null);
  app.decorateRequest('actor', null);
  app.decorateRequest('sessionExpiresAt', null);

  app.addHook('onRequest', async (request, reply) => {
    const level = request.routeOptions.config.auth;
    if (!level) return; // no such route: the not-found handler answers

    const route = request.routeOptions.url ?? '';

    // 1. Origin (design 2.5): a browser on another site must not be able to change anything.
    if (UNSAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      const crossSite =
        origin !== undefined
          ? origin !== allowedOrigin
          : request.headers['sec-fetch-site'] === 'cross-site';
      if (crossSite) {
        auditLog(request.log, {
          action: 'auth.origin_rejected',
          actor_id: null,
          target: { route },
          result: 'failure',
        });
        return reply.code(403).send(errorBody('ORIGIN_NOT_ALLOWED'));
      }
    }

    // 2. Per-IP limit on the public account routes (design 3.3).
    if (RATE_LIMITED_ROUTES.some((suffix) => route.endsWith(suffix))) {
      const retryAfter = countRequest(request.ip, Date.now());
      if (retryAfter !== null) {
        auditLog(request.log, {
          action: 'auth.rate_limited',
          actor_id: null,
          target: { route },
          result: 'failure',
        });
        return reply
          .code(429)
          .header('retry-after', String(retryAfter))
          .send(errorBody('TOO_MANY_REQUESTS', { retry_after_seconds: retryAfter }));
      }
    }

    if (level === 'public') return; // the cookie is not even read

    // 3. Session (design 2.3, steps 1–7).
    const cookie = readSessionCookie(config, request.headers.cookie);
    const result = await service.authenticate(cookie);
    if (!result.ok) {
      if (result.reason === 'blocked') return reply.code(403).send(errorBody('ACCOUNT_BLOCKED'));
      if (cookie !== undefined) reply.header('set-cookie', clearedSessionCookie(config));
      return reply.code(401).send(errorBody('UNAUTHENTICATED'));
    }

    // 4. Role (step 8). An administrator does not pass on student routes, and vice versa.
    if (level !== 'any' && result.user.role !== level) {
      return reply.code(403).send(errorBody('FORBIDDEN'));
    }

    request.user = result.user;
    request.actor = actorFromUser(result.user);
    request.sessionExpiresAt = result.expiresAt;
  });
}
