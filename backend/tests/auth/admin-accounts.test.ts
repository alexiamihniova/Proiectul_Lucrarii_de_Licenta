import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFromUser } from '../../src/core/actor.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { seedOwnedData } from '../helpers/db.js';
import {
  loginRequest,
  registerAdmin,
  registerStudent,
  uniqueEmail,
  userRow,
} from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * What the auth service offers the admin module (UC-13 „Gestionează conturile”, RF21) and the
 * `admin:create` script (Q21). The HTTP routes are built in Segment 7; these tests call the
 * service (`app.auth`) directly. Design: docs/design/auth.md, 5.3 and 6.2.
 */
describe('account administration through the auth service (UC-13, RF21)', () => {
  let ctx: AuthTestApp;
  let admin: TestUser;
  const asAdmin = () => actorFromUser({ id: admin.id, role: 'admin' });
  const me = (user: TestUser) =>
    ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: user.headers });

  beforeAll(async () => {
    ctx = await buildAuthTestApp();
    admin = await registerAdmin(ctx.app, ctx.pool);
  });
  afterAll(() => ctx.close());

  describe('blocking and unblocking', () => {
    it('blocking returns the account as blocked and takes effect on its next request', async () => {
      const student = await registerStudent(ctx.app);
      const result = await ctx.app.auth.setUserStatus(asAdmin(), student.id, 'blocked');

      expect(result).toMatchObject({
        id: student.id,
        email: student.email,
        status: 'blocked',
        role: 'student',
      });
      expect(Object.keys(result).sort()).toEqual(['created_at', 'email', 'id', 'role', 'status']);
      const response = await me(student);
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).code).toBe('ACCOUNT_BLOCKED');
      expect((await loginRequest(ctx.app, student.email, student.password)).statusCode).toBe(403);
    });

    it('blocking deletes nothing', async () => {
      const student = await registerStudent(ctx.app);
      const ids = await seedOwnedData(ctx.pool, student.id);
      await ctx.app.auth.setUserStatus(asAdmin(), student.id, 'blocked');
      const { rows } = await ctx.pool.query('SELECT 1 FROM materials WHERE id = $1', [
        ids.materialId,
      ]);
      expect(rows).toHaveLength(1);
    });

    it('unblocking gives access back, with the same cookie and the same password', async () => {
      const student = await registerStudent(ctx.app);
      await ctx.app.auth.setUserStatus(asAdmin(), student.id, 'blocked');
      const result = await ctx.app.auth.setUserStatus(asAdmin(), student.id, 'active');

      expect(result.status).toBe('active');
      expect((await me(student)).statusCode).toBe(200);
      expect((await loginRequest(ctx.app, student.email, student.password)).statusCode).toBe(200);
    });

    it('refuses with CONFLICT what would change nothing', async () => {
      const student = await registerStudent(ctx.app);
      await expect(
        ctx.app.auth.setUserStatus(asAdmin(), student.id, 'active'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await ctx.app.auth.setUserStatus(asAdmin(), student.id, 'blocked');
      await expect(
        ctx.app.auth.setUserStatus(asAdmin(), student.id, 'blocked'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('answers NOT_FOUND for an account that does not exist', async () => {
      await expect(
        ctx.app.auth.setUserStatus(asAdmin(), 999_999_999, 'blocked'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('an administrator account cannot be blocked: not one’s own, not another’s (Q37)', async () => {
      const another = await registerAdmin(ctx.app, ctx.pool);
      await expect(
        ctx.app.auth.setUserStatus(asAdmin(), admin.id, 'blocked'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        ctx.app.auth.setUserStatus(asAdmin(), another.id, 'blocked'),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await userRow(ctx.pool, another.id))!.status).toBe('active');
    });
  });

  describe('deleting an account', () => {
    it('removes the account and its data like the student’s own deletion, without a password', async () => {
      const student = await registerStudent(ctx.app);
      const ids = await seedOwnedData(ctx.pool, student.id);
      ctx.fileDeletions.length = 0;

      await ctx.app.auth.deleteUser(asAdmin(), student.id);

      expect(await userRow(ctx.pool, student.id)).toBeUndefined();
      expect(
        (await ctx.pool.query('SELECT 1 FROM subjects WHERE id = $1', [ids.subjectId])).rows,
      ).toHaveLength(0);
      expect(
        (
          await ctx.pool.query(
            'SELECT user_id FROM llm_calls WHERE document_id IS NULL AND user_id IS NULL',
          )
        ).rows.length,
      ).toBeGreaterThanOrEqual(1);
      expect(ctx.fileDeletions).toEqual([{ userId: student.id, userStillInDatabase: false }]);
      expect((await me(student)).statusCode).toBe(401);
    });

    it('answers NOT_FOUND for an account that does not exist', async () => {
      await expect(ctx.app.auth.deleteUser(asAdmin(), 999_999_999)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('an administrator account cannot be deleted through the service (Q37)', async () => {
      const another = await registerAdmin(ctx.app, ctx.pool);
      await expect(ctx.app.auth.deleteUser(asAdmin(), admin.id)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await expect(ctx.app.auth.deleteUser(asAdmin(), another.id)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(await userRow(ctx.pool, another.id)).toBeDefined();
    });
  });

  describe('listing accounts', () => {
    it('returns e-mail, creation date, status, role and the number of documents — nothing else (RF21)', async () => {
      const student = await registerStudent(ctx.app);
      await seedOwnedData(ctx.pool, student.id);

      const { items } = await ctx.app.auth.listUsers(asAdmin(), {
        search: student.email,
        page: 1,
        pageSize: 20,
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: student.id,
        email: student.email,
        role: 'student',
        status: 'active',
        document_count: 1,
      });
      expect(Object.keys(items[0]!).sort()).toEqual([
        'created_at',
        'document_count',
        'email',
        'id',
        'role',
        'status',
      ]);
    });

    it('does not count soft-deleted documents', async () => {
      const student = await registerStudent(ctx.app);
      const ids = await seedOwnedData(ctx.pool, student.id);
      await ctx.pool.query(
        `UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = $1`,
        [ids.documentId],
      );
      const { items } = await ctx.app.auth.listUsers(asAdmin(), {
        search: student.email,
        page: 1,
        pageSize: 20,
      });
      expect(items[0]!.document_count).toBe(0);
    });

    it('searches by a part of the e-mail, ignoring case', async () => {
      const marker = `cautare${Date.now()}`;
      const a = await registerStudent(ctx.app, { email: uniqueEmail(`${marker}.a`) });
      const b = await registerStudent(ctx.app, { email: uniqueEmail(`${marker}.b`) });
      const { items, total } = await ctx.app.auth.listUsers(asAdmin(), {
        search: marker.toUpperCase(),
        page: 1,
        pageSize: 20,
      });
      expect(total).toBe(2);
      expect(items.map((item) => item.id).sort()).toEqual([a.id, b.id].sort());
    });

    it('filters by status and paginates, newest first', async () => {
      const marker = `pagina${Date.now()}`;
      const users = [];
      for (let i = 0; i < 3; i += 1)
        users.push(await registerStudent(ctx.app, { email: uniqueEmail(`${marker}.${i}`) }));
      await ctx.app.auth.setUserStatus(asAdmin(), users[0]!.id, 'blocked');

      const blocked = await ctx.app.auth.listUsers(asAdmin(), {
        search: marker,
        status: 'blocked',
        page: 1,
        pageSize: 20,
      });
      expect(blocked.items.map((item) => item.id)).toEqual([users[0]!.id]);

      const firstPage = await ctx.app.auth.listUsers(asAdmin(), {
        search: marker,
        page: 1,
        pageSize: 2,
      });
      const secondPage = await ctx.app.auth.listUsers(asAdmin(), {
        search: marker,
        page: 2,
        pageSize: 2,
      });
      expect(firstPage.total).toBe(3);
      expect(firstPage.items.map((item) => item.id)).toEqual([users[2]!.id, users[1]!.id]);
      expect(secondPage.items.map((item) => item.id)).toEqual([users[0]!.id]);
    });
  });

  describe('only an administrator may use these functions', () => {
    it('a student actor is refused with FORBIDDEN, whatever the function', async () => {
      const student = await registerStudent(ctx.app);
      const target = await registerStudent(ctx.app);
      const actor = actorFromUser({ id: student.id, role: 'student' });

      await expect(ctx.app.auth.listUsers(actor, { page: 1, pageSize: 20 })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(ctx.app.auth.setUserStatus(actor, target.id, 'blocked')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(ctx.app.auth.deleteUser(actor, target.id)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect((await userRow(ctx.pool, target.id))!.status).toBe('active');
    });
  });

  describe('creating an administrator (Q21: only from the command line)', () => {
    it('creates an active administrator who can log in and reach the administration routes', async () => {
      const email = uniqueEmail('root');
      const created = await ctx.app.auth.createAdmin({
        email: `  ${email.toUpperCase()} `,
        password: 'adminParola1',
      });

      expect(created).toMatchObject({ email, role: 'admin', status: 'active' });
      const login = await loginRequest(ctx.app, email, 'adminParola1');
      expect(login.statusCode).toBe(200);
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/admin/settings',
        headers: { cookie },
      });
      expect([401, 403]).not.toContain(response.statusCode);
      expect((await userRow(ctx.pool, created.id))!.password_hash).toMatch(/^\$2[aby]\$04\$/);
    });

    it('applies the same password policy as registration', async () => {
      await expect(
        ctx.app.auth.createAdmin({ email: uniqueEmail('root'), password: 'scurta1' }),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION_DATA' });
      await expect(
        ctx.app.auth.createAdmin({ email: uniqueEmail('root'), password: 'doarlitere' }),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION_DATA' });
      await expect(
        ctx.app.auth.createAdmin({ email: 'not-an-email', password: 'adminParola1' }),
      ).rejects.toMatchObject({ code: 'INVALID_REGISTRATION_DATA' });
      await expect(
        ctx.app.auth.createAdmin({ email: uniqueEmail('root'), password: `${'ă'.repeat(40)}1a` }),
      ).rejects.toMatchObject({ code: 'PASSWORD_TOO_LONG' });
    });

    it('refuses an address that already has an account', async () => {
      const student = await registerStudent(ctx.app);
      await expect(
        ctx.app.auth.createAdmin({ email: student.email, password: 'adminParola1' }),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
      expect((await userRow(ctx.pool, student.id))!.role).toBe('student');
    });

    it('there is no way to become an administrator through the API', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: uniqueEmail(),
          password: 'parola123',
          password_confirmation: 'parola123',
          gdpr_consent: true,
          role: 'admin',
        },
      });
      expect(response.json().user.role).toBe('student');
      const student = await registerStudent(ctx.app);
      await ctx.app.inject({
        method: 'PATCH',
        url: '/api/v1/preferences',
        headers: student.headers,
        payload: { role: 'admin' },
      });
      expect((await userRow(ctx.pool, student.id))!.role).toBe('student');
    });
  });

  it('getUserById returns the public view of an account, or null', async () => {
    const student = await registerStudent(ctx.app);
    const found = await ctx.app.auth.getUserById(student.id);
    expect(found).toMatchObject({
      id: student.id,
      email: student.email,
      role: 'student',
      status: 'active',
    });
    expect(Object.keys(found!).sort()).toEqual(['created_at', 'email', 'id', 'role', 'status']);
    expect(await ctx.app.auth.getUserById(999_999_999)).toBeNull();
  });
});
