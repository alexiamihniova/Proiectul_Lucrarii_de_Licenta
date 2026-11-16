import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { count } from '../helpers/db.js';
import { loginRequest, sessionCookie, uniqueEmail, userRow } from '../helpers/session.js';

/** UC-01 „Creează cont” — RF1, M01, M02, C-23. Design: docs/design/auth.md, sections 1 and 2. */
describe('registration (UC-01, RF1)', () => {
  let ctx: AuthTestApp;
  beforeAll(async () => void (ctx = await buildAuthTestApp()));
  afterAll(() => ctx.close());

  const register = (body: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: body });

  const valid = (overrides: Record<string, unknown> = {}) => ({
    email: uniqueEmail(),
    password: 'parola123',
    password_confirmation: 'parola123',
    gdpr_consent: true,
    ...overrides,
  });

  it('creates a student account and answers 201 with the user and the session expiry', async () => {
    const body = valid();
    const before = Date.now();
    const response = await register(body);

    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json.user).toMatchObject({ email: body.email, role: 'student', status: 'active' });
    expect(Number.isInteger(json.user.id)).toBe(true);
    expect(Object.keys(json.user).sort()).toEqual(['created_at', 'email', 'id', 'role', 'status']);
    expect(Object.keys(json).sort()).toEqual(['expires_at', 'user']);

    const expires = new Date(json.expires_at).getTime();
    expect(expires).toBeGreaterThan(before + 24 * 3600_000 - 5000);
    expect(expires).toBeLessThan(Date.now() + 24 * 3600_000 + 5000);
  });

  it('opens a session: the response sets the session cookie', async () => {
    const response = await register(valid());
    const cookie = sessionCookie(ctx.app, response);
    expect(cookie?.value).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `${cookie!.name}=${cookie!.value}` },
    });
    expect(me.statusCode).toBe(200);
  });

  it('stores the password only as a bcrypt hash with the configured cost (RNF6)', async () => {
    const body = valid({ password: 'secret-Parola9', password_confirmation: 'secret-Parola9' });
    const response = await register(body);
    const row = await userRow(ctx.pool, response.json().user.id);

    expect(row!.password_hash).toMatch(/^\$2[aby]\$04\$[./A-Za-z0-9]{53}$/); // BCRYPT_COST=4 in tests
    expect(row!.password_hash).not.toContain('secret-Parola9');
    expect(JSON.stringify(response.json())).not.toContain('password');
  });

  it('gives two accounts with the same password different hashes (salt)', async () => {
    const a = await register(valid());
    const b = await register(valid());
    const hashA = (await userRow(ctx.pool, a.json().user.id))!.password_hash;
    const hashB = (await userRow(ctx.pool, b.json().user.id))!.password_hash;
    expect(hashA).not.toBe(hashB);
  });

  it('records the GDPR consent time and starts with no failed logins (RF1, RNF8)', async () => {
    const before = Date.now();
    const response = await register(valid());
    const row = await userRow(ctx.pool, response.json().user.id);
    expect(row!.gdpr_consent_at.getTime()).toBeGreaterThanOrEqual(before - 2000);
    expect(row!.gdpr_consent_at.getTime()).toBeLessThanOrEqual(Date.now() + 2000);
    expect(row).toMatchObject({ failed_login_attempts: 0, locked_until: null, status: 'active' });
  });

  it('creates the preferences row with the default values (C-23, Q5)', async () => {
    const response = await register(valid());
    const { rows } = await ctx.pool.query('SELECT * FROM preferences WHERE user_id = $1', [
      response.json().user.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      theme: 'light',
      mascot_enabled: true,
      reminder_channel: 'in_app',
      daily_goal: 20,
      last_reminder_sent_on: null,
    });
    expect(String(rows[0].reminder_time)).toMatch(/^18:00/);
  });

  it('normalises the e-mail: trims it and lower-cases it (design 1.1)', async () => {
    const address = uniqueEmail('Mixed.CASE');
    const response = await register(valid({ email: `  ${address.toUpperCase()}  ` }));
    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe(address.toLowerCase());
    expect((await userRow(ctx.pool, response.json().user.id))!.email).toBe(address.toLowerCase());
  });

  it('always creates a student, even if the body asks for another role or status', async () => {
    const response = await register(valid({ role: 'admin', status: 'blocked', id: 1 }));
    expect(response.statusCode).toBe(201);
    const row = await userRow(ctx.pool, response.json().user.id);
    expect(row).toMatchObject({ role: 'student', status: 'active' });
  });

  it('accepts the boundaries: 8 and 64 characters, letters of any alphabet', async () => {
    for (const password of ['abcdefg1', `${'a'.repeat(63)}1`, 'пароль12', 'țărână12']) {
      const response = await register(valid({ password, password_confirmation: password }));
      expect(response.statusCode, password).toBe(201);
    }
  });

  it('does not trim or change the password: spaces are part of it', async () => {
    const email = uniqueEmail();
    const password = '  parola 123  ';
    expect(
      (await register(valid({ email, password, password_confirmation: password }))).statusCode,
    ).toBe(201);
    expect((await loginRequest(ctx.app, email, password)).statusCode).toBe(200);
    expect((await loginRequest(ctx.app, email, 'parola 123')).statusCode).toBe(401);
  });

  describe('invalid data → 400 INVALID_REGISTRATION_DATA (M01), no account, no cookie', () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ['e-mail without a domain', { email: 'not-an-email' }, 'body/email'],
      ['e-mail missing', { email: undefined }, 'body/email'],
      ['e-mail longer than 254 characters', { email: `${'a'.repeat(250)}@x.md` }, 'body/email'],
      [
        'password of 7 characters',
        { password: 'abcde12', password_confirmation: 'abcde12' },
        'body/password',
      ],
      [
        'password of 65 characters',
        { password: `${'a'.repeat(64)}1`, password_confirmation: `${'a'.repeat(64)}1` },
        'body/password',
      ],
      [
        'password without a digit',
        { password: 'doarlitere', password_confirmation: 'doarlitere' },
        'body/password',
      ],
      [
        'password without a letter',
        { password: '12345678', password_confirmation: '12345678' },
        'body/password',
      ],
      ['password missing', { password: undefined }, 'body/password'],
      [
        'confirmation different from the password',
        { password_confirmation: 'parola124' },
        'body/password_confirmation',
      ],
      ['confirmation missing', { password_confirmation: undefined }, 'body/password_confirmation'],
      ['consent refused', { gdpr_consent: false }, 'body/gdpr_consent'],
      ['consent missing', { gdpr_consent: undefined }, 'body/gdpr_consent'],
    ];

    it.each(cases)('%s', async (_name, overrides, path) => {
      const users = await count(ctx.pool, 'users');
      const response = await register(valid(overrides));

      expect(response.statusCode).toBe(400);
      const error = errorOf(response);
      expect(error.code).toBe('INVALID_REGISTRATION_DATA');
      expect(error.message).toBe(ERRORS.INVALID_REGISTRATION_DATA.message);
      const paths = (error.details as { path: string; message: string }[]).map((d) => d.path);
      expect(paths).toContain(path);

      expect(sessionCookie(ctx.app, response)).toBeUndefined();
      expect(await count(ctx.pool, 'users')).toBe(users);
    });

    it('lists every invalid field at once', async () => {
      const response = await register({
        email: 'x',
        password: 'short',
        password_confirmation: 'y',
        gdpr_consent: false,
      });
      const paths = (errorOf(response).details as { path: string }[]).map((d) => d.path);
      expect(paths).toEqual(
        expect.arrayContaining(['body/email', 'body/password', 'body/gdpr_consent']),
      );
    });

    it('answers M01, not a generic error, for an empty body too', async () => {
      const response = await register({});
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('INVALID_REGISTRATION_DATA');
    });
  });

  it('rejects a password longer than 72 bytes with a message that states the limit (Q34)', async () => {
    const password = `${'ă'.repeat(40)}1a`; // 42 characters, 82 bytes: valid by RF1, too long for bcrypt
    expect(password.length).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(password)).toBeGreaterThan(72);
    const users = await count(ctx.pool, 'users');

    const response = await register(valid({ password, password_confirmation: password }));

    expect(response.statusCode).toBe(400);
    const error = errorOf(response);
    expect(error.code).toBe('PASSWORD_TOO_LONG');
    expect(error.message).toBe(ERRORS.PASSWORD_TOO_LONG.message);
    expect(error.message).toContain('72');
    expect(await count(ctx.pool, 'users')).toBe(users);
  });

  it('accepts a password of exactly 72 bytes', async () => {
    const password = `${'ă'.repeat(35)}1a`; // 37 characters, 72 bytes
    expect(Buffer.byteLength(password)).toBe(72);
    const email = uniqueEmail();
    expect(
      (await register(valid({ email, password, password_confirmation: password }))).statusCode,
    ).toBe(201);
    expect((await loginRequest(ctx.app, email, password)).statusCode).toBe(200);
  });

  describe('e-mail already registered → 409 EMAIL_ALREADY_EXISTS (M02)', () => {
    it('refuses the same address', async () => {
      const body = valid();
      await register(body);
      const users = await count(ctx.pool, 'users');
      const response = await register(body);

      expect(response.statusCode).toBe(409);
      expect(errorOf(response)).toMatchObject({
        code: 'EMAIL_ALREADY_EXISTS',
        message: ERRORS.EMAIL_ALREADY_EXISTS.message,
      });
      expect(sessionCookie(ctx.app, response)).toBeUndefined();
      expect(await count(ctx.pool, 'users')).toBe(users);
    });

    it('refuses the same address in another case or with spaces around it', async () => {
      const body = valid();
      await register(body);
      expect((await register(valid({ email: String(body.email).toUpperCase() }))).statusCode).toBe(
        409,
      );
      expect((await register(valid({ email: ` ${String(body.email)} ` }))).statusCode).toBe(409);
    });

    it('does not change the existing account', async () => {
      const body = valid();
      const first = await register(body);
      const before = await userRow(ctx.pool, first.json().user.id);
      await register({ ...body, password: 'altaParola9', password_confirmation: 'altaParola9' });
      expect(await userRow(ctx.pool, first.json().user.id)).toEqual(before);
      expect((await loginRequest(ctx.app, String(body.email), 'parola123')).statusCode).toBe(200);
    });

    it('when two registrations for one address race, exactly one succeeds', async () => {
      const body = valid();
      const responses = await Promise.all([register(body), register(body), register(body)]);
      const statuses = responses.map((r) => r.statusCode).sort();
      expect(statuses).toEqual([201, 409, 409]);
    });
  });
});
