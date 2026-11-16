import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import {
  DEFAULT_PASSWORD,
  loginRequest,
  registerStudent,
  sessionCookie,
  uniqueEmail,
  userRow,
} from '../helpers/session.js';

/** UC-02 „Se autentifică” — RF2, M03. Design: docs/design/auth.md, sections 2 and 3. */
describe('login (UC-02, RF2)', () => {
  let ctx: AuthTestApp;
  beforeAll(async () => void (ctx = await buildAuthTestApp()));
  afterAll(() => ctx.close());

  it('answers 200 with the user and the expiry, and sets the session cookie', async () => {
    const user = await registerStudent(ctx.app);
    const before = Date.now();
    const response = await loginRequest(ctx.app, user.email, user.password);

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.user).toMatchObject({
      id: user.id,
      email: user.email,
      role: 'student',
      status: 'active',
    });
    const expires = new Date(json.expires_at).getTime();
    expect(expires).toBeGreaterThan(before + 24 * 3600_000 - 5000);
    expect(expires).toBeLessThan(Date.now() + 24 * 3600_000 + 5000);
    expect(sessionCookie(ctx.app, response)?.value).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(JSON.stringify(json)).not.toMatch(/password|hash/i);
  });

  it('accepts the e-mail in any case and with spaces around it', async () => {
    const user = await registerStudent(ctx.app);
    expect((await loginRequest(ctx.app, user.email.toUpperCase(), user.password)).statusCode).toBe(
      200,
    );
    expect((await loginRequest(ctx.app, `  ${user.email} `, user.password)).statusCode).toBe(200);
  });

  it('is case-sensitive for the password', async () => {
    const user = await registerStudent(ctx.app, { password: 'Parola123' });
    expect((await loginRequest(ctx.app, user.email, 'parola123')).statusCode).toBe(401);
    expect((await loginRequest(ctx.app, user.email, 'Parola123')).statusCode).toBe(200);
  });

  describe('wrong credentials → 401 INVALID_CREDENTIALS (M03)', () => {
    it('answers M03 for a wrong password and sets no cookie', async () => {
      const user = await registerStudent(ctx.app);
      const response = await loginRequest(ctx.app, user.email, 'gresita123');
      expect(response.statusCode).toBe(401);
      expect(errorOf(response)).toEqual({
        code: 'INVALID_CREDENTIALS',
        message: ERRORS.INVALID_CREDENTIALS.message,
      });
      expect(sessionCookie(ctx.app, response)).toBeUndefined();
    });

    it('answers exactly the same for an address without an account (anti-enumeration)', async () => {
      const user = await registerStudent(ctx.app);
      const wrongPassword = await loginRequest(ctx.app, user.email, 'gresita123');
      const unknownEmail = await loginRequest(ctx.app, uniqueEmail('nobody'), 'gresita123');

      expect(unknownEmail.statusCode).toBe(wrongPassword.statusCode);
      expect(unknownEmail.body).toBe(wrongPassword.body);
      expect(sessionCookie(ctx.app, unknownEmail)).toBeUndefined();
    });

    it('counts the failure on the account', async () => {
      const user = await registerStudent(ctx.app);
      await loginRequest(ctx.app, user.email, 'gresita123');
      await loginRequest(ctx.app, user.email, 'gresita124');
      expect((await userRow(ctx.pool, user.id))!.failed_login_attempts).toBe(2);
    });

    it('a successful login resets the counter', async () => {
      const user = await registerStudent(ctx.app);
      await loginRequest(ctx.app, user.email, 'gresita123');
      await loginRequest(ctx.app, user.email, user.password);
      expect(await userRow(ctx.pool, user.id)).toMatchObject({
        failed_login_attempts: 0,
        locked_until: null,
      });
    });
  });

  describe('malformed request → 400 VALIDATION_ERROR (the generic format, not M03)', () => {
    it.each([
      ['no body', {}],
      ['e-mail that is not an address', { email: 'x', password: DEFAULT_PASSWORD }],
      ['empty password', { email: 'ana@example.com', password: '' }],
      [
        'password longer than 64 characters',
        { email: 'ana@example.com', password: 'a1'.repeat(40) },
      ],
    ])('%s', async (_name, payload) => {
      const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('account blocked by an administrator (RF21, Q36)', () => {
    it('answers 403 ACCOUNT_BLOCKED with the correct password, and sets no cookie', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);

      const response = await loginRequest(ctx.app, user.email, user.password);
      expect(response.statusCode).toBe(403);
      expect(errorOf(response)).toEqual({
        code: 'ACCOUNT_BLOCKED',
        message: ERRORS.ACCOUNT_BLOCKED.message,
      });
      expect(sessionCookie(ctx.app, response)).toBeUndefined();
    });

    it('answers M03 with a wrong password: the block is not revealed without the password', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);
      const response = await loginRequest(ctx.app, user.email, 'gresita123');
      expect(response.statusCode).toBe(401);
      expect(errorOf(response).code).toBe('INVALID_CREDENTIALS');
    });

    it('lets the user in again after being unblocked', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);
      await ctx.pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [user.id]);
      expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(200);
    });
  });

  it('logging in again while logged in simply issues a new session', async () => {
    const user = await registerStudent(ctx.app);
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: user.headers,
      payload: { email: user.email, password: user.password },
    });
    expect(response.statusCode).toBe(200);
    expect(sessionCookie(ctx.app, response)?.value).toBeTruthy();
  });

  it('re-hashes the password when the configured cost changed, without breaking the new session (ADR-0010)', async () => {
    const user = await registerStudent(ctx.app); // hashed with cost 4
    const stronger = await buildAuthTestApp({ BCRYPT_COST: '5' });
    try {
      const response = await loginRequest(stronger.app, user.email, user.password);
      expect(response.statusCode).toBe(200);
      expect((await userRow(ctx.pool, user.id))!.password_hash).toMatch(/^\$2[aby]\$05\$/);

      // The fingerprint in the new cookie must match the NEW hash.
      const cookie = sessionCookie(stronger.app, response)!;
      const me = await stronger.app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `${cookie.name}=${cookie.value}` },
      });
      expect(me.statusCode).toBe(200);
      expect((await loginRequest(stronger.app, user.email, user.password)).statusCode).toBe(200);
    } finally {
      await stronger.close();
    }
  });
});
