import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, ERROR_CODES } from './errors.js';

/**
 * Shared API conventions. Every router builds its route schemas from these helpers so the
 * contract stays uniform:
 *
 *  - JSON field names are snake_case; ids are integers; timestamps are ISO 8601 UTC strings;
 *    calendar dates are `YYYY-MM-DD`.
 *  - Errors:      `{ error: { code, message, details? } }`            (ErrorResponse)
 *  - Collections: `{ items, total, page, page_size }`                 (paginated())
 *  - List query:  `?page=1&page_size=20`                              (PaginationQuery)
 */

export const Id = z.int().positive().meta({ description: 'Numeric identifier', example: 42 });
export const IdParam = z.coerce.number().int().positive();
export const Timestamp = z.iso
  .datetime()
  .meta({ description: 'ISO 8601 timestamp, UTC', example: '2026-11-12T09:30:00.000Z' });
export const DateOnly = z.iso.date().meta({ description: 'Calendar date', example: '2026-11-12' });

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.enum(ERROR_CODES).describe('Stable machine-readable error code'),
      message: z.string().describe('Human-readable message in Romanian, safe to display'),
      details: z
        .unknown()
        .optional()
        .describe(
          'Optional extra data. For VALIDATION_ERROR: array of { path, message }. ' +
            'Other codes document their own shape in the error catalogue.',
        ),
    }),
  })
  .meta({ id: 'ErrorResponse' });

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1).describe('1-based page number'),
  page_size: z.coerce.number().int().min(1).max(100).default(20).describe('Items per page'),
});

export function paginated<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({
      items: z.array(item),
      total: z.int().min(0).describe('Total number of items across all pages'),
      page: z.int().min(1),
      page_size: z.int().min(1),
    })
    .meta({ id });
}

export const NoContent = z.undefined().describe('No content');

export type Auth = 'public' | 'student' | 'admin' | 'any';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Who may call the route. Set by `endpoint()`. The auth module enforces it with ONE global
     * `onRequest` hook (before body validation) that reads `request.routeOptions.config.auth`;
     * routers never check roles themselves. See docs/design/auth.md, section 6.
     */
    auth?: Auth;
  }
}

interface EndpointMeta {
  /** Use cases served (UC-01 … UC-17); printed in the summary so the contract is traceable. */
  uc: string[];
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  /** `public`: no session. `student` / `admin`: role required. `any`: any authenticated user. */
  auth: Auth;
  /** Extra error statuses besides the automatic 400/401/403/500/501. */
  errors?: number[];
}

interface EndpointSchema {
  params?: z.ZodType;
  querystring?: z.ZodType;
  body?: z.ZodType;
  response: Record<number, unknown>;
}

function errorResponses(auth: Auth, statuses: number[]): Record<number, typeof ErrorResponse> {
  const all = new Set<number>([400, 500, 501, ...statuses]);
  if (auth !== 'public') {
    all.add(401);
    all.add(403);
  }
  const result: Record<number, typeof ErrorResponse> = {};
  for (const status of [...all].sort((a, b) => a - b)) result[status] = ErrorResponse;
  return result;
}

/**
 * Builds the `config` + `schema` of a route. Spread the result into `app.route({ ... })`.
 * Every route of the API is declared through this helper, so documentation, access level and
 * error responses cannot drift apart.
 */
export function endpoint<S extends EndpointSchema>(meta: EndpointMeta, schema: S) {
  const authNote =
    meta.auth === 'public'
      ? 'Public (no session required).'
      : meta.auth === 'any'
        ? 'Requires an authenticated session (any role).'
        : `Requires an authenticated session with role \`${meta.auth}\`.`;
  return {
    config: { auth: meta.auth },
    schema: {
      operationId: meta.operationId,
      tags: [meta.tag],
      summary: `[${meta.uc.join(', ')}] ${meta.summary}`,
      description: [meta.description, authNote].filter(Boolean).join('\n\n'),
      security: meta.auth === 'public' ? [] : [{ cookieAuth: [] }],
      ...schema,
      response: {
        ...schema.response,
        ...errorResponses(meta.auth, meta.errors ?? []),
      } as S['response'] & Record<number, typeof ErrorResponse>,
    },
  };
}

/**
 * Startup guard: every route registered in this scope must say who may call it. A route added
 * without `endpoint()` (and therefore without `config.auth`) makes the application fail to
 * start instead of being silently reachable by anyone.
 */
export function requireDeclaredAccess(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    if (route.method === 'HEAD' || route.method === 'OPTIONS') return;
    if (!route.config?.auth) {
      throw new Error(
        `Route ${String(route.method)} ${route.url} does not declare its access level; declare it with endpoint().`,
      );
    }
  });
}

/** Handler for contract-only routes. Segments replace it with the real handler. */
export function notImplemented(): never {
  throw new AppError('NOT_IMPLEMENTED');
}
