import { afterEach, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { count } from '../helpers/db.js';
import { DEFAULT_PASSWORD, registerStudent, uniqueEmail, userRow } from '../helpers/session.js';

/**
 * Per-IP limit on the public account routes and per-account limit on reset links.
 * The SRS gives no figures: they are proposals (Q33) and come from configuration.
 * Design: docs/design/auth.md, 3.3.
 */
describe('rate limiting (Q33)', () => {
  let ctx: AuthTestApp | undefined;
  afterEach(async () => {
    await ctx?.close();
    ctx = undefined;
  });

  const login = (
    app: AuthTestApp,
    options: { ip?: string; email?: string; headers?: Record<string, string> } = {},
  ) =>
    app.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: options.ip ?? '203.0.113.10',
      headers: options.headers,
      payload: { email: options.email ?? 'nobody@example.com', password: DEFAULT_PASSWORD },
    });

  it('after RATE_LIMIT_AUTH_MAX requests from one address answers 429 TOO_MANY_REQUESTS', async () => {
    ctx = await buildAuthTestApp({
      RATE_LIMIT_AUTH_MAX: '3',
      RATE_LIMIT_AUTH_WINDOW_SECONDS: '60',
    });
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await login(ctx)).statusCode);
    expect(statuses).toEqual([401, 401, 401]);

    const fourth = await login(ctx);
    expect(fourth.statusCode).toBe(429);
    const error = errorOf(fourth);
    expect(error.code).toBe('TOO_MANY_REQUESTS');
    expect(error.message).toBe(ERRORS.TOO_MANY_REQUESTS.message);
    const seconds = (error.details as { retry_after_seconds: number }).retry_after_seconds;
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(60);
    expect(Number(fourth.headers['retry-after'])).toBe(seconds);
  });

  it('counts the public account routes together', async () => {
    ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '4' });
    const ip = '203.0.113.20';
    const send = (url: string, payload: object) =>
      ctx!.app.inject({ method: 'POST', url, remoteAddress: ip, payload });

    const email = uniqueEmail();
    const statuses = [
      (
        await send('/api/v1/auth/register', {
          email,
          password: DEFAULT_PASSWORD,
          password_confirmation: DEFAULT_PASSWORD,
          gdpr_consent: true,
        })
      ).statusCode,
      (await send('/api/v1/auth/login', { email, password: DEFAULT_PASSWORD })).statusCode,
      (await send('/api/v1/auth/password-reset/request', { email })).statusCode,
      (
        await send('/api/v1/auth/password-reset/confirm', {
          token: 'x',
          password: DEFAULT_PASSWORD,
          password_confirmation: DEFAULT_PASSWORD,
        })
      ).statusCode,
    ];
    expect(statuses).toEqual([201, 200, 202, 400]);
    expect(
      (await send('/api/v1/auth/login', { email, password: DEFAULT_PASSWORD })).statusCode,
    ).toBe(429);
    expect(
      (
        await send('/api/v1/auth/register', {
          email: uniqueEmail(),
          password: DEFAULT_PASSWORD,
          password_confirmation: DEFAULT_PASSWORD,
          gdpr_consent: true,
        })
      ).statusCode,
    ).toBe(429);
    expect((await send('/api/v1/auth/password-reset/request', { email })).statusCode).toBe(429);
  });

  it('is per address: another client is not affected', async () => {
    ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '2' });
    await login(ctx, { ip: '203.0.113.30' });
    await login(ctx, { ip: '203.0.113.30' });
    expect((await login(ctx, { ip: '203.0.113.30' })).statusCode).toBe(429);
    expect((await login(ctx, { ip: '203.0.113.31' })).statusCode).toBe(401);
  });

  it('a refused request does nothing: no failed-login count, no account, no e-mail', async () => {
    ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '2' });
    const ip = '203.0.113.40';
    const user = await registerStudent(ctx.app); // from 127.0.0.1: another bucket
    await login(ctx, { ip, email: user.email }); // correct password: 200, uses up the bucket
    await login(ctx, { ip, email: user.email });

    const users = await count(ctx.pool, 'users');
    const refused = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ip,
      payload: { email: user.email, password: 'gresita123' },
    });
    expect(refused.statusCode).toBe(429);
    expect(errorOf(refused).code).toBe('TOO_MANY_REQUESTS');
    expect((await userRow(ctx.pool, user.id))!.failed_login_attempts).toBe(0);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      remoteAddress: ip,
      payload: { email: user.email },
    });
    expect(ctx.mail).toHaveLength(0);
    expect(await count(ctx.pool, 'users')).toBe(users);
  });

  it('is refused before validation: a malformed body still answers 429', async () => {
    ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '1' });
    const ip = '203.0.113.50';
    await login(ctx, { ip });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: ip,
      payload: {},
    });
    expect(response.statusCode).toBe(429);
  });

  it('does not limit protected routes or /health', async () => {
    ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '2' });
    const user = await registerStudent(ctx.app);
    for (let i = 0; i < 6; i += 1) {
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: user.headers }))
          .statusCode,
      ).toBe(200);
      expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    }
  });

  it('the window passes: requests are accepted again', async () => {
    ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '1', RATE_LIMIT_AUTH_WINDOW_SECONDS: '1' });
    const ip = '203.0.113.60';
    expect((await login(ctx, { ip })).statusCode).toBe(401);
    expect((await login(ctx, { ip })).statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await login(ctx, { ip })).statusCode).toBe(401);
  });

  it('the counters belong to the application instance, not to the process', async () => {
    ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '1' });
    const ip = '203.0.113.70';
    await login(ctx, { ip });
    expect((await login(ctx, { ip })).statusCode).toBe(429);
    const fresh = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '1' });
    try {
      expect((await login(fresh, { ip })).statusCode).toBe(401);
    } finally {
      await fresh.close();
    }
  });

  describe('client address', () => {
    it('ignores X-Forwarded-For by default: a client cannot escape the limit by lying', async () => {
      ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '1' });
      const ip = '203.0.113.80';
      await login(ctx, { ip, headers: { 'x-forwarded-for': '198.51.100.1' } });
      const second = await login(ctx, { ip, headers: { 'x-forwarded-for': '198.51.100.2' } });
      expect(second.statusCode).toBe(429);
    });

    it('uses X-Forwarded-For when TRUST_PROXY=true (behind a reverse proxy)', async () => {
      ctx = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '1', TRUST_PROXY: 'true' });
      const proxy = '203.0.113.90';
      expect(
        (await login(ctx, { ip: proxy, headers: { 'x-forwarded-for': '198.51.100.1' } }))
          .statusCode,
      ).toBe(401);
      expect(
        (await login(ctx, { ip: proxy, headers: { 'x-forwarded-for': '198.51.100.2' } }))
          .statusCode,
      ).toBe(401);
      expect(
        (await login(ctx, { ip: proxy, headers: { 'x-forwarded-for': '198.51.100.1' } }))
          .statusCode,
      ).toBe(429);
    });
  });

  describe('reset links per account', () => {
    const request = (app: AuthTestApp, email: string) =>
      app.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        payload: { email },
      });

    it('creates at most PASSWORD_RESET_MAX_PER_HOUR links per hour and still answers 202', async () => {
      ctx = await buildAuthTestApp({ PASSWORD_RESET_MAX_PER_HOUR: '2' });
      const user = await registerStudent(ctx.app);

      const statuses = [];
      for (let i = 0; i < 4; i += 1) statuses.push((await request(ctx, user.email)).statusCode);

      expect(statuses).toEqual([202, 202, 202, 202]); // no enumeration, no hint about the limit
      expect(ctx.mail).toHaveLength(2);
      const { rows } = await ctx.pool.query(
        'SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1',
        [user.id],
      );
      expect(rows[0].n).toBe(2);
    });

    it('counts only the last hour', async () => {
      ctx = await buildAuthTestApp({ PASSWORD_RESET_MAX_PER_HOUR: '1' });
      const user = await registerStudent(ctx.app);
      await request(ctx, user.email);
      await ctx.pool.query(
        `UPDATE password_reset_tokens SET created_at = now() - interval '61 minutes', expires_at = now() - interval '1 minute' WHERE user_id = $1`,
        [user.id],
      );
      await request(ctx, user.email);
      expect(ctx.mail).toHaveLength(2);
    });

    it('is per account', async () => {
      ctx = await buildAuthTestApp({ PASSWORD_RESET_MAX_PER_HOUR: '1' });
      const a = await registerStudent(ctx.app);
      const b = await registerStudent(ctx.app);
      await request(ctx, a.email);
      await request(ctx, a.email);
      await request(ctx, b.email);
      expect(ctx.mail.map((m) => m.to)).toEqual([a.email, b.email]);
    });
  });
});
