import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { seedOwnedData } from '../helpers/db.js';
import { registerAdmin, registerStudent, userRow } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/** UC-12 „Exportă sau șterge datele” — RF20 (export), RNF8, Q11. Design: section 5.4. */
describe('data export (UC-12, RF20)', () => {
  let ctx: AuthTestApp;
  let user: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    ctx = await buildAuthTestApp();
    user = await registerStudent(ctx.app);
    other = await registerStudent(ctx.app);
    const mine = await seedOwnedData(ctx.pool, user.id);
    const theirs = await seedOwnedData(ctx.pool, other.id);
    await ctx.pool.query(`UPDATE subjects SET name = 'Materia mea' WHERE id = $1`, [
      mine.subjectId,
    ]);
    await ctx.pool.query(`UPDATE subjects SET name = 'Materia altcuiva' WHERE id = $1`, [
      theirs.subjectId,
    ]);
    await ctx.pool.query(`UPDATE concepts SET name = 'Conceptul altcuiva' WHERE id = $1`, [
      theirs.conceptId,
    ]);
  });
  afterAll(() => ctx.close());

  const exportAs = (who: TestUser, query = '') =>
    ctx.app.inject({ method: 'GET', url: `/api/v1/account/export${query}`, headers: who.headers });

  describe('JSON', () => {
    it('is the default format and downloads as a dated .json file', async () => {
      const response = await exportAs(user);
      expect(response.statusCode).toBe(200);
      expect(String(response.headers['content-type'])).toMatch(/^application\/json/);
      expect(String(response.headers['content-disposition'])).toMatch(
        /^attachment; filename="recap-export-\d{4}-\d{2}-\d{2}\.json"$/,
      );
      expect((await exportAs(user, '?format=json')).statusCode).toBe(200);
    });

    it('contains the account, the preferences, subjects, concepts, results and progress (RF20)', async () => {
      const body = (await exportAs(user)).json();
      expect(Object.keys(body).sort()).toEqual(
        [
          'answers',
          'concepts',
          'exported_at',
          'preferences',
          'progress',
          'subjects',
          'tests',
          'user',
        ].sort(),
      );
      expect(body.user).toMatchObject({ id: user.id, email: user.email, role: 'student' });
      expect(body.preferences).toMatchObject({ theme: 'light', daily_goal: 20 });
      expect(body.subjects).toHaveLength(1);
      expect(body.subjects[0].name).toBe('Materia mea');
      expect(body.concepts).toHaveLength(1);
      expect(body.tests).toHaveLength(1);
      expect(body.answers).toHaveLength(2);
      expect(body.progress).toHaveLength(1);
      expect(Math.abs(new Date(body.exported_at).getTime() - Date.now())).toBeLessThan(10_000);
    });

    it('contains only the user’s own data (RNF7)', async () => {
      const text = (await exportAs(user)).body;
      expect(text).not.toContain('Materia altcuiva');
      expect(text).not.toContain('Conceptul altcuiva');
      expect(text).not.toContain(other.email);
    });

    it('contains no credential: no password hash, no reset token, no session', async () => {
      const text = (await exportAs(user)).body;
      const hash = (await userRow(ctx.pool, user.id))!.password_hash;
      expect(text).not.toContain(hash);
      expect(text).not.toMatch(/password|token_hash|pfp/i);
      expect(text).not.toContain(user.token);
    });

    it('an account with no study data exports empty lists', async () => {
      const fresh = await registerStudent(ctx.app);
      const body = (await exportAs(fresh)).json();
      expect(body).toMatchObject({
        subjects: [],
        concepts: [],
        tests: [],
        answers: [],
        progress: [],
      });
    });
  });

  describe('CSV (Q11)', () => {
    it('downloads a dated ZIP archive', async () => {
      const response = await exportAs(user, '?format=csv');
      expect(response.statusCode).toBe(200);
      expect(String(response.headers['content-type'])).toMatch(/^application\/zip/);
      expect(String(response.headers['content-disposition'])).toMatch(
        /^attachment; filename="recap-export-\d{4}-\d{2}-\d{2}\.zip"$/,
      );
      expect(response.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK'); // ZIP signature
    });

    it('holds one CSV file per data set', async () => {
      const archive = (await exportAs(user, '?format=csv')).rawPayload.toString('latin1');
      for (const name of [
        'subjects.csv',
        'concepts.csv',
        'tests.csv',
        'answers.csv',
        'progress.csv',
      ]) {
        expect(archive, name).toContain(name); // file names are stored uncompressed in a ZIP
      }
    });
  });

  it('refuses an unknown format with 400', async () => {
    const response = await exportAs(user, '?format=xml');
    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
  });

  it('is for students only: an administrator has no study data to export', async () => {
    const admin = await registerAdmin(ctx.app, ctx.pool);
    expect((await exportAs(admin)).statusCode).toBe(403);
  });

  it('needs a session', async () => {
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/v1/account/export' })).statusCode,
    ).toBe(401);
  });

  it('changes nothing: it is a GET', async () => {
    const before = await userRow(ctx.pool, user.id);
    await exportAs(user);
    await exportAs(user, '?format=csv');
    expect(await userRow(ctx.pool, user.id)).toEqual(before);
  });
});
