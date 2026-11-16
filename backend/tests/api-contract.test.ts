import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type pg from 'pg';
import { ERRORS } from '../src/core/errors.js';
import { requireDeclaredAccess } from '../src/core/http.js';
import type { Database } from '../src/db/client.js';
import { generateOpenApi } from '../src/scripts/export-openapi.js';
import { buildTestApp } from './helpers/app.js';
import { createTestPool } from './helpers/db.js';
import { BODIES } from './helpers/sample-bodies.js';
import { sessionsIfAuthExists } from './helpers/session.js';
import type { TestUser } from './helpers/session.js';

interface Operation {
  operationId: string;
  summary: string;
  tags: string[];
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean }[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
}

/**
 * Tags (= modules) whose routes are implemented and therefore no longer answer 501.
 * A segment adds its tag here when it replaces its stubs, e.g. Segment 1B adds 'auth'.
 */
const IMPLEMENTED_TAGS: string[] = ['auth'];

describe('API contract', () => {
  let app: FastifyInstance;
  let db: Database;
  let pool: pg.Pool;
  let sessions: { student?: TestUser; admin?: TestUser } = {};

  /**
   * `app.inject` as someone allowed to call the route: an administrator under /admin, a
   * student elsewhere. Before the auth module exists there are no sessions and no hook.
   */
  const inject = (options: InjectOptions & { url: string }) => {
    const user = options.url.startsWith('/api/v1/admin/') ? sessions.admin : sessions.student;
    return app.inject({ ...options, headers: { ...user?.headers, ...options.headers } });
  };
  let spec: OpenApi;
  let operations: { method: string; path: string; op: Operation }[];

  beforeAll(async () => {
    ({ app, db } = await buildTestApp());
    pool = createTestPool();
    sessions = await sessionsIfAuthExists(app, pool);
    spec = app.swagger() as unknown as OpenApi;
    operations = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.entries(item).map(([method, op]) => ({ method: method.toUpperCase(), path, op })),
    );
  });

  afterAll(async () => {
    const ids = [sessions.student?.id, sessions.admin?.id].filter((id) => id !== undefined);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    await pool.end();
    await app.close();
    await db.close();
  });

  const apiOperations = () => operations.filter(({ op }) => !op.tags.includes('system'));

  it('docs/openapi.json is the document generated from the code', async () => {
    const committed = readFileSync(resolve('..', 'docs', 'openapi.json'), 'utf8');
    expect(committed, 'run `make openapi` and commit docs/openapi.json').toBe(
      await generateOpenApi(),
    );
  });

  it('covers every use case UC-01 … UC-17', () => {
    const covered = new Set(
      apiOperations().flatMap(({ op }) => [...op.summary.matchAll(/UC-\d{2}/g)].map((m) => m[0])),
    );
    const expected = Array.from({ length: 17 }, (_, i) => `UC-${String(i + 1).padStart(2, '0')}`);
    expect([...covered].sort()).toEqual(expected);
  });

  it('every operation names its use cases, has a unique operationId and one module tag', () => {
    const ids = new Set<string>();
    for (const { op, path } of apiOperations()) {
      expect(op.summary, path).toMatch(/^\[UC-\d{2}(, UC-\d{2})*\] /);
      expect(ids.has(op.operationId), `duplicate operationId ${op.operationId}`).toBe(false);
      ids.add(op.operationId);
      expect(op.tags).toHaveLength(1);
    }
  });

  it('all routes live under /api/v1 and use snake_case path parameters', () => {
    for (const { path } of apiOperations()) {
      expect(path).toMatch(/^\/api\/v1\/[a-z0-9\-/{}_]+$/);
    }
  });

  it('a route that does not declare its access level stops the application from starting', async () => {
    const bare = Fastify();
    await bare.register(async (scope) => {
      requireDeclaredAccess(scope);
      scope.get('/declared', { config: { auth: 'student' } }, async () => 'ok');
      expect(() => scope.get('/forgotten', async () => 'ok')).toThrow(/access level/);
    });
    await bare.ready();
    await bare.close();
  });

  it('documentation and access level agree: public routes need no session, admin routes need admin', () => {
    const publicOperations = apiOperations()
      .filter(({ op }) => op.security?.length === 0)
      .map(({ op }) => op.operationId)
      .sort();
    expect(publicOperations).toEqual([
      'confirmPasswordReset',
      'login',
      'register',
      'requestPasswordReset',
      'unsubscribeFromReminders',
    ]);
    for (const { op, path } of apiOperations()) {
      if (path.startsWith('/api/v1/admin/')) {
        expect(JSON.stringify(op), path).toContain('role `admin`');
      }
    }
  });

  it('every operation documents its success response and the standard errors', () => {
    for (const { method, path, op } of apiOperations()) {
      const statuses = Object.keys(op.responses);
      expect(
        statuses.some((s) => s.startsWith('2')),
        `${method} ${path} has no 2xx`,
      ).toBe(true);
      expect(statuses, `${method} ${path}`).toEqual(expect.arrayContaining(['400', '500', '501']));
      if (op.security?.length) {
        expect(statuses, `${method} ${path}`).toEqual(expect.arrayContaining(['401', '403']));
      }
      if (path.includes('{')) expect(statuses, `${method} ${path}`).toContain('404');
    }
  });

  it('collections are paginated the same way everywhere', () => {
    const lists = Object.entries(spec.components.schemas).filter(
      ([name]) => name.endsWith('List') && !name.endsWith('Input'),
    );
    expect(lists.length).toBeGreaterThanOrEqual(8);
    for (const [name, schema] of lists) {
      const properties = Object.keys((schema as { properties: object }).properties);
      expect(properties, name).toEqual(['items', 'total', 'page', 'page_size']);
    }
    for (const { op, path } of apiOperations()) {
      const response = JSON.stringify(op.responses['200'] ?? {});
      if (/List"/.test(response)) {
        const names = (op.parameters ?? []).map((p) => p.name);
        expect(names, path).toEqual(expect.arrayContaining(['page', 'page_size']));
      }
    }
  });

  it('every route that is not implemented yet answers 501 with the single error format', async () => {
    expect(apiOperations().length).toBeGreaterThanOrEqual(60);
    const stubs = apiOperations().filter(({ op }) => !IMPLEMENTED_TAGS.includes(op.tags[0]!));
    for (const { method, path, op } of stubs) {
      const url = path.replace(/\{\w+\}/g, '1');
      const hasBody = ['POST', 'PATCH', 'PUT'].includes(method);
      const payload = BODIES[op.operationId];
      const response =
        op.operationId === 'uploadDocument'
          ? await inject({
              method: 'POST',
              url,
              headers: { 'content-type': 'multipart/form-data; boundary=x' },
              payload:
                '--x\r\ncontent-disposition: form-data; name="file"; filename="a.txt"\r\ncontent-type: text/plain\r\n\r\nhello\r\n--x--\r\n',
            })
          : await inject({
              method: method as 'GET',
              url,
              ...(hasBody && payload ? { payload } : {}),
            });
      expect(response.statusCode, `${method} ${url}: ${response.body}`).toBe(501);
      expect(response.json()).toEqual({
        error: { code: 'NOT_IMPLEMENTED', message: ERRORS.NOT_IMPLEMENTED.message },
      });
    }
  });

  it('every documented request body has an example in this test', () => {
    for (const { op } of apiOperations()) {
      if (op.requestBody && op.operationId !== 'uploadDocument') {
        expect(BODIES[op.operationId], `no example body for ${op.operationId}`).toBeDefined();
      }
    }
  });

  describe('error format', () => {
    it('validation errors list each invalid field', async () => {
      const response = await app.inject({
        method: 'POST',
        // /auth/login: the generic format. /auth/register answers M01 instead (design 1.2).
        url: '/api/v1/auth/login',
        payload: { email: 'not-an-email', password: '' },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe(ERRORS.VALIDATION_ERROR.message);
      const paths = body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['body/email', 'body/password']));
    });

    it.each([
      ['query', '/api/v1/subjects?page=0'],
      ['query', '/api/v1/subjects?page_size=101'],
      ['params', '/api/v1/subjects/abc'],
      ['params', '/api/v1/documents/-1'],
    ])('rejects an invalid %s: %s', async (_kind, url) => {
      const response = await inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('enforces the documented limits of the specification', async () => {
      const post = (url: string, payload: unknown) =>
        inject({ method: 'POST', url, payload: payload as object });
      const cases: [string, unknown][] = [
        ['/api/v1/subjects', { name: 'x'.repeat(101) }], // RF3: 1–100
        ['/api/v1/subjects', { name: '   ' }],
        ['/api/v1/concepts', { name: 'x'.repeat(81), definition: '', passage_ids: [1] }], // RF8: 1–80
        ['/api/v1/concepts', { name: 'ok', definition: 'x'.repeat(301), passage_ids: [1] }], // ≤ 300
        ['/api/v1/concepts', { name: 'ok', definition: '', passage_ids: [] }], // ≥ 1 passage
        [
          '/api/v1/materials/generate',
          { document_id: 1, type: 'flashcard', concept_ids: [], count: 1 },
        ], // 1–20
        [
          '/api/v1/materials/generate',
          { document_id: 1, type: 'flashcard', concept_ids: [1], count: 21 },
        ],
        [
          '/api/v1/materials/generate',
          { document_id: 1, type: 'true_false', concept_ids: [1], count: 1 },
        ], // RF10: 4 types
        [
          '/api/v1/tests',
          { subject_id: 1, question_count: 4, types: ['open'], difficulty: 'easy' },
        ], // RF11: 5–30
        [
          '/api/v1/tests',
          { subject_id: 1, question_count: 31, types: ['open'], difficulty: 'easy' },
        ],
        ['/api/v1/tests', { subject_id: 1, question_count: 10, types: [], difficulty: 'easy' }],
        ['/api/v1/materials/1/reports', { reason: 'x'.repeat(301) }], // C-19: 1–300
        ['/api/v1/materials/1/reports', { reason: '' }],
        ['/api/v1/reviews/answers', { material_id: 1, rating: 'perfect' }],
        [
          '/api/v1/auth/register',
          {
            email: `${'a'.repeat(250)}@x.ro`,
            password: 'parola123',
            password_confirmation: 'parola123',
            gdpr_consent: true,
          },
        ], // ≤ 254
        [
          '/api/v1/auth/register',
          {
            email: 'a@x.ro',
            password: 'doarlitere',
            password_confirmation: 'doarlitere',
            gdpr_consent: true,
          },
        ],
        [
          '/api/v1/auth/register',
          {
            email: 'a@x.ro',
            password: '12345678',
            password_confirmation: '12345678',
            gdpr_consent: true,
          },
        ],
      ];
      for (const [url, payload] of cases) {
        const response = await post(url, payload);
        expect(response.statusCode, `${url} ${JSON.stringify(payload).slice(0, 80)}`).toBe(400);
      }
      const patch = (url: string, payload: object) => inject({ method: 'PATCH', url, payload });
      expect((await patch('/api/v1/preferences', { daily_goal: 4 })).statusCode).toBe(400); // RF18: 5–100
      expect((await patch('/api/v1/preferences', { reminder_time: '24:00' })).statusCode).toBe(400);
      expect((await patch('/api/v1/admin/settings', { max_file_size_mb: 51 })).statusCode).toBe(
        400,
      ); // RF25
      expect((await patch('/api/v1/admin/settings', { uploads_per_day: 0 })).statusCode).toBe(400);
    });

    it('unknown routes answer 404 in the same format', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/unknown' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('ROUTE_NOT_FOUND');
    });

    it('malformed JSON answers 400 in the same format', async () => {
      const response = await inject({
        method: 'POST',
        url: '/api/v1/subjects',
        headers: { 'content-type': 'application/json' },
        payload: '{not json',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('error catalogue', () => {
    it('contains the SRS messages M01–M09 (M10 is a confirmation dialog, shown by the UI)', () => {
      const ids = new Set(Object.values(ERRORS).flatMap((def) => ('srs' in def ? [def.srs] : [])));
      expect([...ids].sort()).toEqual([
        'M01',
        'M02',
        'M03',
        'M04',
        'M05',
        'M06',
        'M07',
        'M08',
        'M09',
      ]);
    });

    it('uses valid HTTP statuses and non-empty Romanian messages', () => {
      for (const [code, def] of Object.entries(ERRORS)) {
        expect(code).toMatch(/^[A-Z][A-Z_]+$/);
        expect(def.status).toBeGreaterThanOrEqual(400);
        expect(def.status).toBeLessThan(600);
        expect(def.message.length).toBeGreaterThan(5);
      }
    });
  });
});
