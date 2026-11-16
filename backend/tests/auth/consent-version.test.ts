import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GDPR_CONSENT_VERSION } from '../../src/modules/auth/service.js';
import { buildAuthTestApp } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { registerStudent, uniqueEmail } from '../helpers/session.js';

/** Q42: the version of the consent text accepted at registration is kept on the user. */
describe('consent text version (RF1, Q42)', () => {
  let ctx: AuthTestApp;

  beforeAll(async () => {
    ctx = await buildAuthTestApp();
  });
  afterAll(() => ctx.close());

  const versionOf = async (userId: number) =>
    (await ctx.pool.query('SELECT gdpr_consent_version FROM users WHERE id = $1', [userId])).rows[0]
      .gdpr_consent_version as string;

  it('registration stores the current version of the consent text', async () => {
    const user = await registerStudent(ctx.app);
    expect(GDPR_CONSENT_VERSION).toMatch(/^.{1,20}$/);
    expect(await versionOf(user.id)).toBe(GDPR_CONSENT_VERSION);
  });

  it('an administrator created from the command line gets it too', async () => {
    const admin = await ctx.app.auth.createAdmin({
      email: uniqueEmail('root'),
      password: 'adminParola1',
    });
    expect(await versionOf(admin.id)).toBe(GDPR_CONSENT_VERSION);
  });

  it('the database refuses an account without a version', async () => {
    await expect(
      ctx.pool.query(
        `INSERT INTO users (email, password_hash, gdpr_consent_at) VALUES ($1, 'hash', now())`,
        [uniqueEmail('noversion')],
      ),
    ).rejects.toMatchObject({ code: '23502' }); // not_null_violation
  });

  it('the export tells the student which text they accepted and when (RF20)', async () => {
    const user = await registerStudent(ctx.app);
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/account/export',
      headers: user.headers,
    });
    expect(response.statusCode).toBe(200);
    const exported = response.json().user;
    expect(exported.gdpr_consent_version).toBe(GDPR_CONSENT_VERSION);
    expect(Math.abs(new Date(exported.gdpr_consent_at).getTime() - Date.now())).toBeLessThan(
      10_000,
    );
  });

  it('the session responses do not carry it: it is not needed to use the application', async () => {
    const user = await registerStudent(ctx.app);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: user.headers,
    });
    expect(me.json().user).not.toHaveProperty('gdpr_consent_version');
  });
});
