import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { seedOwnedData } from '../helpers/db.js';
import {
  clearsSession,
  loginRequest,
  registerAdmin,
  registerStudent,
  userRow,
} from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * UC-12 „Exportă sau șterge datele” — RF20 (deletion), M10, C-20, RNF8.
 * Design: docs/design/auth.md, section 5.
 */
describe('account deletion (UC-12, RF20)', () => {
  let ctx: AuthTestApp;
  beforeAll(async () => void (ctx = await buildAuthTestApp()));
  afterAll(() => ctx.close());

  const remove = (user: TestUser, payload: object = { password: user.password }) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/account/delete',
      headers: user.headers,
      payload,
    });

  /** Rows that belong to a user, per table. */
  const owned = async (userId: number) => {
    const one = async (sql: string) => (await ctx.pool.query(sql, [userId])).rows[0].n as number;
    return {
      users: await one('SELECT count(*)::int AS n FROM users WHERE id = $1'),
      preferences: await one('SELECT count(*)::int AS n FROM preferences WHERE user_id = $1'),
      password_reset_tokens: await one(
        'SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1',
      ),
      subjects: await one('SELECT count(*)::int AS n FROM subjects WHERE user_id = $1'),
      tests: await one('SELECT count(*)::int AS n FROM tests WHERE user_id = $1'),
      concept_progress: await one(
        'SELECT count(*)::int AS n FROM concept_progress WHERE user_id = $1',
      ),
      reviews: await one('SELECT count(*)::int AS n FROM reviews WHERE user_id = $1'),
      material_reports: await one(
        'SELECT count(*)::int AS n FROM material_reports WHERE user_id = $1',
      ),
      llm_calls: await one('SELECT count(*)::int AS n FROM llm_calls WHERE user_id = $1'),
    };
  };

  const exists = async (table: string, id: number) =>
    (await ctx.pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rows.length === 1;

  it('with the correct password answers 204 and clears the session cookie', async () => {
    const user = await registerStudent(ctx.app);
    const response = await remove(user);
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(clearsSession(ctx.app, response)).toBe(true);
  });

  it('removes everything the user owns, at once (RF20)', async () => {
    const user = await registerStudent(ctx.app);
    const ids = await seedOwnedData(ctx.pool, user.id);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: user.email },
    });
    expect(await owned(user.id)).toMatchObject({
      users: 1,
      preferences: 1,
      password_reset_tokens: 1,
      subjects: 1,
      tests: 1,
    });

    expect((await remove(user)).statusCode).toBe(204);

    expect(await owned(user.id)).toEqual({
      users: 0,
      preferences: 0,
      password_reset_tokens: 0,
      subjects: 0,
      tests: 0,
      concept_progress: 0,
      reviews: 0,
      material_reports: 0,
      llm_calls: 0,
    });
    for (const [table, id] of [
      ['documents', ids.documentId],
      ['passages', ids.passageId],
      ['concepts', ids.conceptId],
      ['materials', ids.materialId],
      ['tests', ids.testId],
    ] as const) {
      expect(await exists(table, id), table).toBe(false);
    }
    const answers = await ctx.pool.query(
      'SELECT count(*)::int AS n FROM answers WHERE material_id = $1',
      [ids.materialId],
    );
    expect(answers.rows[0].n).toBe(0);
  });

  it('removes soft-deleted documents too', async () => {
    const user = await registerStudent(ctx.app);
    const ids = await seedOwnedData(ctx.pool, user.id);
    await ctx.pool.query(
      `UPDATE documents SET status = 'deleted', deleted_at = now() WHERE id = $1`,
      [ids.documentId],
    );
    await remove(user);
    expect(await exists('documents', ids.documentId)).toBe(false);
  });

  it('keeps the model call journal, without any link to the account (C-20)', async () => {
    const user = await registerStudent(ctx.app);
    await seedOwnedData(ctx.pool, user.id);
    const call = (await ctx.pool.query('SELECT id FROM llm_calls WHERE user_id = $1', [user.id]))
      .rows[0].id;

    await remove(user);

    const { rows } = await ctx.pool.query(
      'SELECT user_id, document_id, operation, status FROM llm_calls WHERE id = $1',
      [call],
    );
    expect(rows).toEqual([
      { user_id: null, document_id: null, operation: 'extract_concepts', status: 'success' },
    ]);
  });

  it('leaves every other account untouched', async () => {
    const user = await registerStudent(ctx.app);
    const other = await registerStudent(ctx.app);
    await seedOwnedData(ctx.pool, user.id);
    const theirs = await seedOwnedData(ctx.pool, other.id);
    const before = await owned(other.id);

    await remove(user);

    expect(await owned(other.id)).toEqual(before);
    expect(await exists('materials', theirs.materialId)).toBe(true);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: other.headers }))
        .statusCode,
    ).toBe(200);
  });

  it('deletes the uploaded files, after the database, exactly once (Q43)', async () => {
    const user = await registerStudent(ctx.app);
    ctx.fileDeletions.length = 0;
    await remove(user);
    expect(ctx.fileDeletions).toEqual([{ userId: user.id, userStillInDatabase: false }]);
  });

  it('stays deleted even if removing the files fails', async () => {
    const user = await registerStudent(ctx.app);
    ctx.failNextFileDeletion();
    const response = await remove(user);
    expect(response.statusCode).toBe(204);
    expect(await userRow(ctx.pool, user.id)).toBeUndefined();
  });

  it('afterwards the old session is dead and the old credentials answer M03', async () => {
    const user = await registerStudent(ctx.app);
    await remove(user);
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: user.headers }))
        .statusCode,
    ).toBe(401);
    const login = await loginRequest(ctx.app, user.email, user.password);
    expect(login.statusCode).toBe(401);
    expect(errorOf(login).code).toBe('INVALID_CREDENTIALS');
  });

  it('the address can be registered again, as a brand-new account', async () => {
    const user = await registerStudent(ctx.app);
    await seedOwnedData(ctx.pool, user.id);
    await remove(user);
    const again = await registerStudent(ctx.app, { email: user.email });
    expect(again.id).not.toBe(user.id);
    expect((await owned(again.id)).subjects).toBe(0);
  });

  describe('confirmation with the password (M10)', () => {
    it('a wrong password answers 403 PASSWORD_CONFIRMATION_FAILED and deletes nothing', async () => {
      const user = await registerStudent(ctx.app);
      await seedOwnedData(ctx.pool, user.id);
      const before = await owned(user.id);
      ctx.fileDeletions.length = 0;

      const response = await remove(user, { password: 'gresita123' });

      expect(response.statusCode).toBe(403);
      expect(errorOf(response)).toEqual({
        code: 'PASSWORD_CONFIRMATION_FAILED',
        message: ERRORS.PASSWORD_CONFIRMATION_FAILED.message,
      });
      expect(await owned(user.id)).toEqual(before);
      expect(ctx.fileDeletions).toEqual([]);
      expect(clearsSession(ctx.app, response)).toBe(false);
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: user.headers }))
          .statusCode,
      ).toBe(200);
    });

    it('a wrong confirmation is not a failed login: it does not count towards the lock', async () => {
      const user = await registerStudent(ctx.app);
      for (let i = 0; i < 6; i += 1) await remove(user, { password: 'gresita123' });
      expect(await userRow(ctx.pool, user.id)).toMatchObject({
        failed_login_attempts: 0,
        locked_until: null,
      });
    });

    it.each([
      ['missing', {}],
      ['empty', { password: '' }],
    ])('a %s password answers 400 and deletes nothing', async (_name, payload) => {
      const user = await registerStudent(ctx.app);
      const response = await remove(user, payload);
      expect(response.statusCode).toBe(400);
      expect(await userRow(ctx.pool, user.id)).toBeDefined();
    });
  });

  it('cannot be aimed at another account: identifiers in the body are ignored', async () => {
    const user = await registerStudent(ctx.app);
    const victim = await registerStudent(ctx.app);
    await remove(user, {
      password: user.password,
      user_id: victim.id,
      id: victim.id,
      email: victim.email,
    });
    expect(await userRow(ctx.pool, victim.id)).toBeDefined();
    expect(await userRow(ctx.pool, user.id)).toBeUndefined();
  });

  it('is for students: an administrator cannot delete their own account this way (Q37)', async () => {
    const admin = await registerAdmin(ctx.app, ctx.pool);
    const response = await remove(admin);
    expect(response.statusCode).toBe(403);
    expect(await userRow(ctx.pool, admin.id)).toBeDefined();
  });

  it('needs a session', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/account/delete',
      payload: { password: 'parola123' },
    });
    expect(response.statusCode).toBe(401);
  });
});
