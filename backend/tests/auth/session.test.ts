import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { PRODUCTION_ENV, buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { decodeJwt, hs256, nowSeconds, passwordFingerprint, signJwt } from '../helpers/jwt.js';
import {
  clearsSession,
  loginRequest,
  registerStudent,
  sessionCookie,
  userRow,
} from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * The session: JWT of at most 24 h in an httpOnly cookie (RF2, RNF6, RFC 7519, C-11).
 * Design: docs/design/auth.md, section 2. ADR-0005, ADR-0011.
 */
describe('session (RF2, RNF6, C-11)', () => {
  let ctx: AuthTestApp;
  let secret: string;
  beforeAll(async () => {
    ctx = await buildAuthTestApp();
    secret = ctx.config.session.secret;
  });
  afterAll(() => ctx.close());

  const me = (cookieValue: string, app = ctx.app) =>
    app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: `${app.config.session.cookieName}=${cookieValue}` },
    });

  /** A token the server must accept: built by hand from the documented format. */
  const forge = async (user: TestUser, overrides: Record<string, unknown> = {}) => {
    const hash = (await userRow(ctx.pool, user.id))!.password_hash;
    const iat = nowSeconds();
    return {
      sub: String(user.id),
      iat,
      exp: iat + 3600,
      pfp: passwordFingerprint(secret, hash),
      ...overrides,
    };
  };

  describe('cookie', () => {
    it('is HttpOnly, SameSite=Lax, Path=/, lasts 24 hours, and is named from configuration', async () => {
      const user = await registerStudent(ctx.app);
      const cookie = sessionCookie(
        ctx.app,
        await loginRequest(ctx.app, user.email, user.password),
      )!;

      expect(cookie.name).toBe('recap_session');
      expect(cookie.attributes.httponly).toBe(true);
      expect(String(cookie.attributes.samesite).toLowerCase()).toBe('lax');
      expect(cookie.attributes.path).toBe('/');
      expect(cookie.attributes['max-age']).toBe(String(24 * 3600));
      expect(cookie.attributes.domain).toBeUndefined();
    });

    it('is not marked Secure outside production (plain HTTP on localhost)', async () => {
      const user = await registerStudent(ctx.app);
      const cookie = sessionCookie(
        ctx.app,
        await loginRequest(ctx.app, user.email, user.password),
      )!;
      expect(cookie.attributes.secure).toBeUndefined();
    });

    it('is marked Secure in production (RNF6: HTTPS only)', async () => {
      const production = await buildAuthTestApp(PRODUCTION_ENV);
      try {
        const user = await registerStudent(production.app);
        const cookie = sessionCookie(
          production.app,
          await loginRequest(production.app, user.email, user.password),
        )!;
        expect(cookie.attributes.secure).toBe(true);
        expect(cookie.attributes.httponly).toBe(true);
      } finally {
        await production.close();
      }
    });

    it('follows SESSION_TTL_HOURS and SESSION_COOKIE_NAME', async () => {
      const short = await buildAuthTestApp({ SESSION_TTL_HOURS: '1', SESSION_COOKIE_NAME: 'sid' });
      try {
        const user = await registerStudent(short.app);
        const response = await loginRequest(short.app, user.email, user.password);
        const cookie = sessionCookie(short.app, response)!;
        expect(cookie.name).toBe('sid');
        expect(cookie.attributes['max-age']).toBe('3600');
        const { payload } = decodeJwt(cookie.value);
        expect(Number(payload.exp) - Number(payload.iat)).toBe(3600);
        const expires = new Date(response.json().expires_at).getTime();
        expect(Math.abs(expires - (Date.now() + 3600_000))).toBeLessThan(5000);
      } finally {
        await short.close();
      }
    });
  });

  describe('token format (design 2.2)', () => {
    it('is a JWT signed with HS256 and SESSION_SECRET', async () => {
      const user = await registerStudent(ctx.app);
      const { header, signature, signingInput } = decodeJwt(user.token);
      expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
      expect(signature).toBe(hs256(signingInput, secret));
    });

    it('carries exactly sub, iat, exp and pfp — no e-mail, no role', async () => {
      const user = await registerStudent(ctx.app);
      const { payload } = decodeJwt(user.token);
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'pfp', 'sub']);
      expect(payload.sub).toBe(String(user.id));
      expect(Number(payload.exp) - Number(payload.iat)).toBe(24 * 3600);
      expect(Math.abs(Number(payload.iat) - nowSeconds())).toBeLessThan(10);
      expect(JSON.stringify(payload)).not.toContain(user.email);
    });

    it('carries the password fingerprint: an HMAC, not a piece of the hash (ADR-0011)', async () => {
      const user = await registerStudent(ctx.app);
      const hash = (await userRow(ctx.pool, user.id))!.password_hash;
      const { payload } = decodeJwt(user.token);

      expect(payload.pfp).toBe(passwordFingerprint(secret, hash));
      expect(String(payload.pfp)).toHaveLength(22);
      // Nothing of the bcrypt hash is readable in the token.
      const decoded = Buffer.from(user.token.split('.')[1]!, 'base64url').toString('utf8');
      for (let i = 0; i + 8 <= hash.length; i += 4) {
        expect(decoded).not.toContain(hash.slice(i, i + 8));
      }
    });

    it('expires_at in the response is the exp of the token', async () => {
      const user = await registerStudent(ctx.app);
      const response = await loginRequest(ctx.app, user.email, user.password);
      const { payload } = decodeJwt(sessionCookie(ctx.app, response)!.value);
      expect(new Date(response.json().expires_at).getTime()).toBe(Number(payload.exp) * 1000);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user and when the session expires', async () => {
      const user = await registerStudent(ctx.app);
      const response = await me(user.token);
      expect(response.statusCode).toBe(200);
      expect(response.json().user).toMatchObject({
        id: user.id,
        email: user.email,
        role: 'student',
        status: 'active',
      });
      const { payload } = decodeJwt(user.token);
      expect(new Date(response.json().expires_at).getTime()).toBe(Number(payload.exp) * 1000);
    });

    it('does not renew the session: no new cookie, same expiry (Q41)', async () => {
      const user = await registerStudent(ctx.app);
      const first = await me(user.token);
      const second = await me(user.token);
      expect(sessionCookie(ctx.app, first)).toBeUndefined();
      expect(second.json().expires_at).toBe(first.json().expires_at);
    });

    it('answers 401 UNAUTHENTICATED without a cookie — the signal for screen D15 (C-11)', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      expect(response.statusCode).toBe(401);
      expect(errorOf(response)).toEqual({
        code: 'UNAUTHENTICATED',
        message: ERRORS.UNAUTHENTICATED.message,
      });
    });

    it('accepts a token built by hand from the documented format', async () => {
      const user = await registerStudent(ctx.app);
      const response = await me(signJwt(await forge(user), secret));
      expect(response.statusCode).toBe(200);
      expect(response.json().user.id).toBe(user.id);
    });
  });

  describe('rejected tokens → 401 UNAUTHENTICATED, identical for every cause, cookie cleared', () => {
    let user: TestUser;
    beforeAll(async () => void (user = await registerStudent(ctx.app)));

    const cases: [string, () => Promise<string>][] = [
      [
        'expired one second ago',
        async () =>
          signJwt(await forge(user, { iat: nowSeconds() - 7200, exp: nowSeconds() - 1 }), secret),
      ],
      [
        'signed with another secret',
        async () => signJwt(await forge(user), 'another-secret-another-secret-0000'),
      ],
      [
        'unsigned, alg "none"',
        async () => signJwt(await forge(user), secret, { alg: 'none', typ: 'JWT' }),
      ],
      [
        'alg "none" with the HS256 signature kept',
        async () => {
          const good = signJwt(await forge(user), secret);
          const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
            'base64url',
          );
          return [header, good.split('.')[1], good.split('.')[2]].join('.');
        },
      ],
      [
        'signed with HS512 instead of HS256',
        async () => signJwt(await forge(user), secret, { alg: 'HS512', typ: 'JWT' }),
      ],
      [
        'payload changed after signing',
        async () => {
          const [header, , signature] = signJwt(await forge(user), secret).split('.');
          const payload = Buffer.from(JSON.stringify(await forge(user, { sub: '1' }))).toString(
            'base64url',
          );
          return [header, payload, signature].join('.');
        },
      ],
      [
        'wrong password fingerprint',
        async () => signJwt(await forge(user, { pfp: 'AAAAAAAAAAAAAAAAAAAAAA' }), secret),
      ],
      [
        'no password fingerprint',
        async () => signJwt(await forge(user, { pfp: undefined }), secret),
      ],
      [
        'a user that does not exist',
        async () => signJwt(await forge(user, { sub: '999999999' }), secret),
      ],
      [
        'a sub that is not a number',
        async () => signJwt(await forge(user, { sub: 'admin' }), secret),
      ],
      ['no expiry', async () => signJwt(await forge(user, { exp: undefined }), secret)],
      ['not a JWT at all', async () => 'garbage'],
      ['an empty value', async () => ''],
      [
        'two parts instead of three',
        async () =>
          signJwt(await forge(user), secret)
            .split('.')
            .slice(0, 2)
            .join('.'),
      ],
    ];

    it.each(cases)('%s', async (_name, build) => {
      const response = await me(await build());
      expect(response.statusCode).toBe(401);
      expect(errorOf(response)).toEqual({
        code: 'UNAUTHENTICATED',
        message: ERRORS.UNAUTHENTICATED.message,
      });
    });

    it('tells the browser to drop a cookie it rejected', async () => {
      const response = await me(signJwt(await forge(user, { exp: nowSeconds() - 1 }), secret));
      expect(clearsSession(ctx.app, response)).toBe(true);
    });

    it('a token from another deployment (different SESSION_SECRET) is worthless', async () => {
      const other = await buildAuthTestApp({ SESSION_SECRET: 'x'.repeat(40) });
      try {
        expect((await me(user.token, other.app)).statusCode).toBe(401);
      } finally {
        await other.close();
      }
    });
  });

  describe('logout (UC-02)', () => {
    it('answers 204 and clears the cookie with the same attributes', async () => {
      const user = await registerStudent(ctx.app);
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: user.headers,
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(clearsSession(ctx.app, response)).toBe(true);
      const cookie = sessionCookie(ctx.app, response)!;
      expect(cookie.attributes.path).toBe('/');
      expect(cookie.attributes.httponly).toBe(true);
    });

    it('needs a session: 401 without one', async () => {
      const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout' });
      expect(response.statusCode).toBe(401);
    });

    it('leaves the account able to log in again', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: user.headers });
      expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(200);
    });
  });
});
