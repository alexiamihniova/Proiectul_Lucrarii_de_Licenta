import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
import { authWorkerTasks } from '../../src/modules/auth/service.js';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import {
  loginRequest,
  registerStudent,
  sessionCookie,
  uniqueEmail,
  userRow,
} from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * UC-03 „Resetează parola” — RF2, C-24: link by e-mail, stored as a hash, valid 1 hour, usable
 * once. Design: docs/design/auth.md, section 4.
 */
describe('password reset (UC-03, RF2, C-24)', () => {
  let ctx: AuthTestApp;
  beforeAll(async () => void (ctx = await buildAuthTestApp({ PASSWORD_RESET_MAX_PER_HOUR: '50' })));
  afterAll(() => ctx.close());
  beforeEach(() => void (ctx.mail.length = 0));

  const request = (email: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email },
    });

  const confirm = (token: string, password = 'nouaParola9', confirmation = password) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, password, password_confirmation: confirmation },
    });

  const tokenFrom = (resetUrl: string) => new URL(resetUrl).searchParams.get('token')!;
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const tokensOf = async (userId: number) =>
    (
      await ctx.pool.query('SELECT * FROM password_reset_tokens WHERE user_id = $1 ORDER BY id', [
        userId,
      ])
    ).rows;

  /** Asks for a reset and returns the token from the e-mail. */
  const requestToken = async (user: TestUser) => {
    const sent = ctx.mail.length;
    await request(user.email);
    expect(ctx.mail).toHaveLength(sent + 1);
    return tokenFrom(ctx.mail.at(-1)!.resetUrl);
  };

  describe('request', () => {
    it('answers 202 with no body and sends the link to the account’s address', async () => {
      const user = await registerStudent(ctx.app);
      const response = await request(user.email);

      expect(response.statusCode).toBe(202);
      expect(response.body).toBe('');
      expect(ctx.mail).toHaveLength(1);
      expect(ctx.mail[0]!.to).toBe(user.email);
    });

    it('the link points to the frontend reset page and carries a 256-bit random token', async () => {
      const user = await registerStudent(ctx.app);
      await request(user.email);
      const url = new URL(ctx.mail[0]!.resetUrl);

      expect(`${url.origin}${url.pathname}`).toBe('http://localhost:5173/reset-password');
      expect([...url.searchParams.keys()]).toEqual(['token']);
      expect(url.searchParams.get('token')).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes, base64url
    });

    it('stores only the SHA-256 hash of the token, never the token (C-24)', async () => {
      const user = await registerStudent(ctx.app);
      const token = await requestToken(user);
      const rows = await tokensOf(user.id);

      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(sha256(token));
      expect(rows[0].used_at).toBeNull();
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it('the link expires one hour after it was created', async () => {
      const user = await registerStudent(ctx.app);
      const before = Date.now();
      await request(user.email);
      const [row] = await tokensOf(user.id);

      expect(row.expires_at.getTime()).toBeGreaterThanOrEqual(before + 3600_000 - 2000);
      expect(row.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 3600_000 + 2000);
      expect(Math.abs(ctx.mail[0]!.expiresAt.getTime() - row.expires_at.getTime())).toBeLessThan(
        1000,
      );
    });

    it('follows PASSWORD_RESET_TTL_MINUTES', async () => {
      const short = await buildAuthTestApp({ PASSWORD_RESET_TTL_MINUTES: '10' });
      try {
        const user = await registerStudent(short.app);
        await short.app.inject({
          method: 'POST',
          url: '/api/v1/auth/password-reset/request',
          payload: { email: user.email },
        });
        const expires = short.mail[0]!.expiresAt.getTime();
        expect(Math.abs(expires - (Date.now() + 600_000))).toBeLessThan(5000);
      } finally {
        await short.close();
      }
    });

    it('each request creates a different token', async () => {
      const user = await registerStudent(ctx.app);
      const first = await requestToken(user);
      const second = await requestToken(user);
      expect(second).not.toBe(first);
      expect(await tokensOf(user.id)).toHaveLength(2);
    });

    it('answers exactly the same for an address without an account, and sends nothing (anti-enumeration)', async () => {
      const user = await registerStudent(ctx.app);
      const known = await request(user.email);
      ctx.mail.length = 0;
      const unknown = await request(uniqueEmail('nobody'));

      expect(unknown.statusCode).toBe(known.statusCode);
      expect(unknown.body).toBe(known.body);
      expect(ctx.mail).toHaveLength(0);
    });

    it('accepts the address in any case and with spaces', async () => {
      const user = await registerStudent(ctx.app);
      await request(`  ${user.email.toUpperCase()} `);
      expect(ctx.mail.map((m) => m.to)).toEqual([user.email]);
    });

    it('answers 400 for something that is not an e-mail address', async () => {
      const response = await request('not-an-email');
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    });

    it('still answers 202 when the e-mail cannot be sent', async () => {
      const user = await registerStudent(ctx.app);
      ctx.failNextMail();
      expect((await request(user.email)).statusCode).toBe(202);
    });

    it('a temporarily locked account can ask for a reset', async () => {
      const user = await registerStudent(ctx.app);
      for (let i = 0; i < 5; i += 1) await loginRequest(ctx.app, user.email, 'gresita123');
      await request(user.email);
      expect(ctx.mail).toHaveLength(1);
    });

    it('an account blocked by an administrator gets 202 but no link (Q36)', async () => {
      const user = await registerStudent(ctx.app);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);
      expect((await request(user.email)).statusCode).toBe(202);
      expect(ctx.mail).toHaveLength(0);
      expect(await tokensOf(user.id)).toHaveLength(0);
    });

    it('does not change the password or the sessions by itself', async () => {
      const user = await registerStudent(ctx.app);
      await request(user.email);
      expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(200);
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: user.headers }))
          .statusCode,
      ).toBe(200);
    });
  });

  describe('confirmation', () => {
    it('answers 204, sets the new password and does not open a session', async () => {
      const user = await registerStudent(ctx.app);
      const response = await confirm(await requestToken(user), 'nouaParola9');

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(sessionCookie(ctx.app, response)?.value ?? '').toBe('');
      expect((await loginRequest(ctx.app, user.email, 'nouaParola9')).statusCode).toBe(200);
      expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(401);
    });

    it('stores the new password as a bcrypt hash', async () => {
      const user = await registerStudent(ctx.app);
      const oldHash = (await userRow(ctx.pool, user.id))!.password_hash;
      await confirm(await requestToken(user), 'nouaParola9');
      const newHash = (await userRow(ctx.pool, user.id))!.password_hash;
      expect(newHash).toMatch(/^\$2[aby]\$04\$/);
      expect(newHash).not.toBe(oldHash);
    });

    it('the link works once: the second use answers 400 RESET_TOKEN_INVALID', async () => {
      const user = await registerStudent(ctx.app);
      const token = await requestToken(user);
      expect((await confirm(token, 'nouaParola9')).statusCode).toBe(204);

      const again = await confirm(token, 'altaParola8');
      expect(again.statusCode).toBe(400);
      expect(errorOf(again)).toEqual({
        code: 'RESET_TOKEN_INVALID',
        message: ERRORS.RESET_TOKEN_INVALID.message,
      });
      expect((await loginRequest(ctx.app, user.email, 'nouaParola9')).statusCode).toBe(200);
      expect((await tokensOf(user.id))[0].used_at).not.toBeNull();
    });

    it('an expired link answers 400 RESET_TOKEN_INVALID and changes nothing', async () => {
      const user = await registerStudent(ctx.app);
      const token = await requestToken(user);
      await ctx.pool.query(
        `UPDATE password_reset_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' WHERE user_id = $1`,
        [user.id],
      );

      const response = await confirm(token);
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('RESET_TOKEN_INVALID');
      expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(200);
    });

    it('a link is still valid one second before the hour is up', async () => {
      const user = await registerStudent(ctx.app);
      const token = await requestToken(user);
      await ctx.pool.query(
        `UPDATE password_reset_tokens SET expires_at = now() + interval '2 seconds' WHERE user_id = $1`,
        [user.id],
      );
      expect((await confirm(token)).statusCode).toBe(204);
    });

    it('unknown, expired and used links answer identically', async () => {
      const user = await registerStudent(ctx.app);
      const used = await requestToken(user);
      await confirm(used);
      const expired = await requestToken(user);
      await ctx.pool.query(
        `UPDATE password_reset_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' WHERE used_at IS NULL AND user_id = $1`,
        [user.id],
      );

      const bodies = [
        (await confirm(used)).body,
        (await confirm(expired)).body,
        (await confirm('A'.repeat(43))).body,
        (await confirm('garbage')).body,
      ];
      expect(new Set(bodies).size).toBe(1);
    });

    it('the hash of a token is not accepted as a token', async () => {
      const user = await registerStudent(ctx.app);
      const token = await requestToken(user);
      expect((await confirm(sha256(token))).statusCode).toBe(400);
    });

    describe('an invalid new password is refused WITHOUT using up the link', () => {
      const cases: [string, string, string | undefined, string][] = [
        ['too short', 'abc12', undefined, 'VALIDATION_ERROR'],
        ['without a digit', 'doarlitere', undefined, 'VALIDATION_ERROR'],
        ['without a letter', '12345678', undefined, 'VALIDATION_ERROR'],
        ['longer than 64 characters', `${'a'.repeat(64)}1`, undefined, 'VALIDATION_ERROR'],
        ['different from its confirmation', 'nouaParola9', 'nouaParola8', 'VALIDATION_ERROR'],
        ['longer than 72 bytes', `${'ă'.repeat(40)}1a`, undefined, 'PASSWORD_TOO_LONG'],
      ];

      it.each(cases)('%s', async (_name, password, confirmation, code) => {
        const user = await registerStudent(ctx.app);
        const token = await requestToken(user);

        const response = await confirm(token, password, confirmation ?? password);
        expect(response.statusCode).toBe(400);
        expect(errorOf(response).code).toBe(code);

        expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(200);
        expect((await confirm(token, 'nouaParola9')).statusCode).toBe(204);
      });
    });

    it('invalidates every other outstanding link of the account (Q39)', async () => {
      const user = await registerStudent(ctx.app);
      const first = await requestToken(user);
      const second = await requestToken(user);

      expect((await confirm(second, 'nouaParola9')).statusCode).toBe(204);
      expect((await confirm(first, 'altaParola8')).statusCode).toBe(400);
      expect((await loginRequest(ctx.app, user.email, 'nouaParola9')).statusCode).toBe(200);
      expect(
        (await tokensOf(user.id)).every((row: { used_at: Date | null }) => row.used_at !== null),
      ).toBe(true);
    });

    it('until one is used, several links are valid at once (Dosar, Tabelul 5.3)', async () => {
      const user = await registerStudent(ctx.app);
      const first = await requestToken(user);
      await requestToken(user);
      expect((await confirm(first, 'nouaParola9')).statusCode).toBe(204);
    });

    it('closes every existing session of the account (ADR-0011)', async () => {
      const user = await registerStudent(ctx.app);
      const second = await loginRequest(ctx.app, user.email, user.password);
      const secondCookie = sessionCookie(ctx.app, second)!;
      const me = (cookie: string) =>
        ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });
      expect((await me(user.headers.cookie)).statusCode).toBe(200);

      await confirm(await requestToken(user), 'nouaParola9');

      expect((await me(user.headers.cookie)).statusCode).toBe(401);
      expect((await me(`${secondCookie.name}=${secondCookie.value}`)).statusCode).toBe(401);
    });

    it('leaves other accounts and their sessions alone', async () => {
      const user = await registerStudent(ctx.app);
      const other = await registerStudent(ctx.app);
      await confirm(await requestToken(user), 'nouaParola9');
      expect(
        (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: other.headers }))
          .statusCode,
      ).toBe(200);
      expect((await loginRequest(ctx.app, other.email, other.password)).statusCode).toBe(200);
    });

    it('lifts a temporary lock: the user proved they own the mailbox (Q38)', async () => {
      const user = await registerStudent(ctx.app);
      for (let i = 0; i < 5; i += 1) await loginRequest(ctx.app, user.email, 'gresita123');
      expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(429);

      await confirm(await requestToken(user), 'nouaParola9');

      expect(await userRow(ctx.pool, user.id)).toMatchObject({
        failed_login_attempts: 0,
        locked_until: null,
      });
      expect((await loginRequest(ctx.app, user.email, 'nouaParola9')).statusCode).toBe(200);
    });

    it('does not lift an administrator’s block', async () => {
      const user = await registerStudent(ctx.app);
      const token = await requestToken(user);
      await ctx.pool.query(`UPDATE users SET status = 'blocked' WHERE id = $1`, [user.id]);
      await confirm(token, 'nouaParola9');
      expect((await userRow(ctx.pool, user.id))!.status).toBe('blocked');
      expect((await loginRequest(ctx.app, user.email, 'nouaParola9')).statusCode).toBe(403);
    });

    it('two simultaneous confirmations with one link: exactly one succeeds', async () => {
      const user = await registerStudent(ctx.app);
      const token = await requestToken(user);
      const responses = await Promise.all([
        confirm(token, 'primaParola1'),
        confirm(token, 'adouaParola2'),
      ]);
      expect(responses.map((r) => r.statusCode).sort()).toEqual([204, 400]);
    });

    it('answers 400 VALIDATION_ERROR when the token is missing', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/confirm',
        payload: { password: 'nouaParola9', password_confirmation: 'nouaParola9' },
      });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('cleanup of old links (SRS 2.1.7)', () => {
    it('purgeResetTokens deletes expired and used links, keeps valid ones, and returns the count', async () => {
      await ctx.pool.query('DELETE FROM password_reset_tokens');
      const user = await registerStudent(ctx.app);
      const other = await registerStudent(ctx.app);
      await confirm(await requestToken(user)); // used
      await requestToken(user); // will be expired
      await ctx.pool.query(
        `UPDATE password_reset_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' WHERE used_at IS NULL AND user_id = $1`,
        [user.id],
      );
      const valid = await requestToken(other);

      expect(await ctx.app.auth.purgeResetTokens()).toBe(2);
      expect(await tokensOf(user.id)).toHaveLength(0);
      expect(await tokensOf(other.id)).toHaveLength(1);
      expect((await confirm(valid)).statusCode).toBe(204);
    });

    it('runs as a worker task, once an hour', async () => {
      const tasks = authWorkerTasks(ctx.app.auth);
      const purge = tasks.find((task) => task.name === 'auth:purge-reset-tokens');
      expect(purge).toBeDefined();
      expect(purge!.intervalMs).toBe(3_600_000);

      const user = await registerStudent(ctx.app);
      await requestToken(user);
      await ctx.pool.query(
        `UPDATE password_reset_tokens SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' WHERE user_id = $1`,
        [user.id],
      );
      await purge!.run(new AbortController().signal);
      expect(await tokensOf(user.id)).toHaveLength(0);
    });
  });
});
