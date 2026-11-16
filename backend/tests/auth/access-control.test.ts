import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { fillPath, isUnsafe, label, loadOperations } from '../helpers/openapi.js';
import type { ApiOperation } from '../helpers/openapi.js';
import { BODIES } from '../helpers/sample-bodies.js';
import { registerAdmin, registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * The one global hook (design 6.1): who may call what. Walks EVERY operation of the contract,
 * so a route added later is covered without anyone writing a test for it.
 * SRS 3.7.2 (Tabelul 3.25), RNF7; UC-13–16 are administrator-only.
 */
const operations = loadOperations();
const protectedOps = operations.filter((o) => o.access !== 'public');
const each = (list: ApiOperation[]) => list.map((o) => [label(o), o] as const);

describe('access control on every route (RNF7, SRS 3.7.2)', () => {
  let ctx: AuthTestApp;
  let student: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    ctx = await buildAuthTestApp();
    student = await registerStudent(ctx.app);
    admin = await registerAdmin(ctx.app, ctx.pool);
  });
  afterAll(() => ctx.close());

  /** A well-formed request for the operation, so that only access control can refuse it. */
  const call = (operation: ApiOperation, user?: TestUser) =>
    ctx.app.inject({
      method: operation.method,
      url: fillPath(operation.path, () => 999_999_999),
      headers: user?.headers,
      ...(isUnsafe(operation) && BODIES[operation.op.operationId] !== undefined
        ? { payload: BODIES[operation.op.operationId] as object }
        : {}),
    });

  it('the contract has the expected shape', () => {
    expect(
      operations
        .filter((o) => o.access === 'public')
        .map((o) => o.op.operationId)
        .sort(),
    ).toEqual([
      'confirmPasswordReset',
      'login',
      'register',
      'requestPasswordReset',
      'unsubscribeFromReminders',
    ]);
    expect(
      operations
        .filter((o) => o.access === 'admin')
        .every((o) => o.path.startsWith('/api/v1/admin/')),
    ).toBe(true);
    expect(
      operations
        .filter((o) => o.path.startsWith('/api/v1/admin/'))
        .every((o) => o.access === 'admin'),
    ).toBe(true);
    expect(protectedOps.length).toBeGreaterThanOrEqual(55);
  });

  describe('a visitor (no session)', () => {
    it.each(each(protectedOps))('%s → 401 UNAUTHENTICATED', async (_label, operation) => {
      const response = await call(operation);
      expect(response.statusCode).toBe(401);
      expect(errorOf(response)).toEqual({
        code: 'UNAUTHENTICATED',
        message: ERRORS.UNAUTHENTICATED.message,
      });
    });

    it('is refused BEFORE the body is validated: no validation details leak', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/subjects',
        payload: { name: '' },
      });
      expect(response.statusCode).toBe(401);
      expect(errorOf(response).details).toBeUndefined();
    });

    it('is refused before path parameters are validated too', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/subjects/not-a-number',
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('a student', () => {
    it.each(each(operations.filter((o) => o.access === 'admin')))(
      '%s → 403 FORBIDDEN',
      async (_label, operation) => {
        const response = await call(operation, student);
        expect(response.statusCode).toBe(403);
        expect(errorOf(response)).toEqual({ code: 'FORBIDDEN', message: ERRORS.FORBIDDEN.message });
      },
    );

    it.each(each(operations.filter((o) => o.access === 'student' || o.access === 'any')))(
      '%s → let through',
      async (_label, operation) => {
        // deleteAccount would delete the shared student; its own tests cover it.
        if (operation.op.operationId === 'deleteAccount' || operation.op.operationId === 'logout')
          return;
        const response = await call(operation, student);
        expect([401, 403], response.body).not.toContain(response.statusCode);
      },
    );
  });

  describe('an administrator', () => {
    it.each(each(operations.filter((o) => o.access === 'student')))(
      '%s → 403 FORBIDDEN: no access to study data (SRS 3.4)',
      async (_label, operation) => {
        const response = await call(operation, admin);
        expect(response.statusCode).toBe(403);
        expect(errorOf(response).code).toBe('FORBIDDEN');
      },
    );

    it.each(each(operations.filter((o) => o.access === 'admin' || o.access === 'any')))(
      '%s → let through',
      async (_label, operation) => {
        if (operation.op.operationId === 'logout') return;
        const response = await call(operation, admin);
        expect([401, 403], response.body).not.toContain(response.statusCode);
      },
    );
  });

  describe('public routes', () => {
    it.each(each(operations.filter((o) => o.access === 'public')))(
      '%s is reachable without a session',
      async (_label, operation) => {
        const response = await call(operation);
        expect(response.statusCode).not.toBe(401);
      },
    );

    it('ignore a broken session cookie instead of failing', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        headers: { cookie: `${ctx.config.session.cookieName}=garbage` },
        payload: { email: 'nobody@example.com' },
      });
      expect(response.statusCode).toBe(202);
    });
  });

  describe('the account is read from the database on every request (ADR-0011)', () => {
    it('a role change takes effect on the next request, with the same cookie', async () => {
      const user = await registerStudent(ctx.app);
      const adminRoute = {
        method: 'GET' as const,
        url: '/api/v1/admin/settings',
        headers: user.headers,
      };
      expect((await ctx.app.inject(adminRoute)).statusCode).toBe(403);

      await ctx.pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);
      expect((await ctx.app.inject(adminRoute)).statusCode).not.toBe(403);

      await ctx.pool.query(`UPDATE users SET role = 'student' WHERE id = $1`, [user.id]);
      expect((await ctx.app.inject(adminRoute)).statusCode).toBe(403);
    });

    it('a blocked account gets 403 ACCOUNT_BLOCKED on its next request, on every protected route', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);

      for (const url of ['/api/v1/auth/me', '/api/v1/subjects', '/api/v1/preferences']) {
        const response = await ctx.app.inject({ method: 'GET', url, headers: user.headers });
        expect(response.statusCode, url).toBe(403);
        expect(errorOf(response)).toEqual({
          code: 'ACCOUNT_BLOCKED',
          message: ERRORS.ACCOUNT_BLOCKED.message,
        });
      }
    });

    it('an unblocked account works again with the cookie it already had', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);
      await ctx.pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [user.id]);
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: user.headers,
      });
      expect(response.statusCode).toBe(200);
    });

    it('a deleted account gets 401 on its next request', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.pool.query('DELETE FROM users WHERE id = $1', [user.id]);
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: user.headers,
      });
      expect(response.statusCode).toBe(401);
      expect(errorOf(response).code).toBe('UNAUTHENTICATED');
    });

    it('a blocked administrator loses the administration routes too', async () => {
      const blocked = await registerAdmin(ctx.app, ctx.pool);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [blocked.id]);
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/users',
        headers: blocked.headers,
      });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe('ACCOUNT_BLOCKED');
    });
  });

  it('/health stays public and outside the hook', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
  });
});
