import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { registerStudent, sessionCookie, userRow } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * CSRF (SRS 3.5.1, OWASP): SameSite=Lax plus an origin check on every method that changes data.
 * Design: docs/design/auth.md, 2.5. ADR-0011.
 */
describe('cross-site request forgery (SRS 3.5.1, ADR-0011)', () => {
  let ctx: AuthTestApp;
  let user: TestUser;
  const OWN_ORIGIN = 'http://localhost:5173'; // origin of APP_BASE_URL (the default)

  beforeAll(async () => {
    ctx = await buildAuthTestApp();
    user = await registerStudent(ctx.app);
  });
  afterAll(() => ctx.close());

  const patchPreferences = (headers: Record<string, string>) =>
    ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/preferences',
      headers: { ...user.headers, ...headers },
      payload: { theme: 'dark' },
    });

  const theme = async () =>
    (await ctx.pool.query('SELECT theme FROM preferences WHERE user_id = $1', [user.id])).rows[0]
      .theme;

  it('refuses a state-changing request from another origin, with 403 ORIGIN_NOT_ALLOWED', async () => {
    const response = await patchPreferences({ origin: 'https://evil.example' });
    expect(response.statusCode).toBe(403);
    expect(errorOf(response)).toEqual({
      code: 'ORIGIN_NOT_ALLOWED',
      message: ERRORS.ORIGIN_NOT_ALLOWED.message,
    });
    expect(await theme()).toBe('light');
  });

  it.each([
    ['a look-alike host', 'http://localhost:5173.evil.example'],
    ['the same host on another port', 'http://localhost:9999'],
    ['the same host with another scheme', 'https://localhost:5173'],
    ['the literal "null" origin (sandboxed frames, some redirects)', 'null'],
  ])('refuses %s', async (_name, origin) => {
    expect((await patchPreferences({ origin })).statusCode).toBe(403);
    expect(await theme()).toBe('light');
  });

  it('refuses a request the browser marks as cross-site when there is no Origin header', async () => {
    const response = await patchPreferences({ 'sec-fetch-site': 'cross-site' });
    expect(response.statusCode).toBe(403);
    expect(errorOf(response).code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('accepts a request from the application’s own origin', async () => {
    const response = await patchPreferences({
      origin: OWN_ORIGIN,
      'sec-fetch-site': 'same-origin',
    });
    expect(response.statusCode).toBe(200);
    expect(await theme()).toBe('dark');
  });

  it('accepts a request without Origin or Sec-Fetch-Site (not a browser: no ambient cookies)', async () => {
    expect((await patchPreferences({})).statusCode).toBe(200);
  });

  it('the allowed origin follows APP_BASE_URL, ignoring its path', async () => {
    const other = await buildAuthTestApp({ APP_BASE_URL: 'https://recap.example.md/app' });
    try {
      const student = await registerStudent(other.app);
      const send = (origin: string) =>
        other.app.inject({
          method: 'PATCH',
          url: '/api/v1/preferences',
          headers: { ...student.headers, origin },
          payload: { theme: 'dark' },
        });
      expect((await send('https://recap.example.md')).statusCode).toBe(200);
      expect((await send(OWN_ORIGIN)).statusCode).toBe(403);
    } finally {
      await other.close();
    }
  });

  it.each(['POST', 'PATCH', 'DELETE'] as const)('checks %s requests', async (method) => {
    const url = method === 'PATCH' ? '/api/v1/preferences' : '/api/v1/subjects/1';
    const response = await ctx.app.inject({
      method,
      url: method === 'POST' ? '/api/v1/subjects' : url,
      headers: { ...user.headers, origin: 'https://evil.example' },
      ...(method === 'DELETE' ? {} : { payload: { name: 'x', theme: 'dark' } }),
    });
    expect(response.statusCode).toBe(403);
    expect(errorOf(response).code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('does not check GET requests: they never change data', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { ...user.headers, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('protects the public routes too: no cross-site login or registration (login CSRF)', async () => {
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: user.email, password: user.password },
    });
    expect(login.statusCode).toBe(403);
    expect(sessionCookie(ctx.app, login)).toBeUndefined();
    expect((await userRow(ctx.pool, user.id))!.failed_login_attempts).toBe(0);

    const reset = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      headers: { origin: 'https://evil.example' },
      payload: { email: user.email },
    });
    expect(reset.statusCode).toBe(403);
    expect(ctx.mail).toHaveLength(0);
  });

  it('is checked before the session: a cross-site request learns nothing about it', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/subjects',
      headers: { origin: 'https://evil.example' },
      payload: { name: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(errorOf(response).code).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('protects the file upload, which a plain cross-site form could otherwise send', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/subjects/1/documents',
      headers: {
        ...user.headers,
        origin: 'https://evil.example',
        'content-type': 'multipart/form-data; boundary=x',
      },
      payload:
        '--x\r\ncontent-disposition: form-data; name="file"; filename="a.txt"\r\n\r\nhi\r\n--x--\r\n',
    });
    expect(response.statusCode).toBe(403);
  });
});
