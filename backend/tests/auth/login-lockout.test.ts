import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/core/errors.js';
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
 * RF2, M03, C-12, C-17: after 5 consecutive failed logins for the same e-mail, login is refused
 * for 15 minutes; the state is kept on the account and ends by itself.
 * Design: docs/design/auth.md, 3.1 and 3.2.
 */
describe('lockout after failed logins (RF2, C-12, C-17)', () => {
  let ctx: AuthTestApp;
  beforeAll(async () => void (ctx = await buildAuthTestApp()));
  afterAll(() => ctx.close());

  const fail = (user: TestUser, times: number) =>
    (async () => {
      const responses = [];
      for (let i = 0; i < times; i += 1) {
        responses.push(await loginRequest(ctx.app, user.email, `gresita${i}00`));
      }
      return responses;
    })();

  it('the first 4 failures answer 401; the 5th answers 429 and locks the account for 15 minutes', async () => {
    const user = await registerStudent(ctx.app);
    const before = Date.now();
    const responses = await fail(user, 5);

    expect(responses.slice(0, 4).map((r) => r.statusCode)).toEqual([401, 401, 401, 401]);
    const fifth = responses[4]!;
    expect(fifth.statusCode).toBe(429);
    const error = errorOf(fifth);
    expect(error.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(error.message).toBe(ERRORS.ACCOUNT_TEMPORARILY_LOCKED.message);

    const row = (await userRow(ctx.pool, user.id))!;
    expect(row.failed_login_attempts).toBe(5);
    expect(row.status).toBe('active'); // "temporarily locked" is not a stored status (Q2)
    expect(row.locked_until!.getTime()).toBeGreaterThanOrEqual(before + 15 * 60_000 - 2000);
    expect(row.locked_until!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 2000);
  });

  it('tells how long is left: details.retry_after_seconds and the Retry-After header (C-12)', async () => {
    const user = await registerStudent(ctx.app);
    const fifth = (await fail(user, 5))[4]!;
    const seconds = (errorOf(fifth).details as { retry_after_seconds: number }).retry_after_seconds;

    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(890);
    expect(seconds).toBeLessThanOrEqual(900);
    expect(Number(fifth.headers['retry-after'])).toBe(seconds);
  });

  it('while locked, even the correct password answers 429, opens no session and changes nothing', async () => {
    const user = await registerStudent(ctx.app);
    await fail(user, 5);
    const lockedUntil = (await userRow(ctx.pool, user.id))!.locked_until;

    const response = await loginRequest(ctx.app, user.email, user.password);
    expect(response.statusCode).toBe(429);
    expect(errorOf(response).code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
    expect(sessionCookie(ctx.app, response)).toBeUndefined();

    await fail(user, 3);
    const row = (await userRow(ctx.pool, user.id))!;
    expect(row.failed_login_attempts).toBe(5);
    expect(row.locked_until).toEqual(lockedUntil); // the lock is not extended by more attempts
  });

  it('the remaining time counts down', async () => {
    const user = await registerStudent(ctx.app);
    await fail(user, 5);
    await ctx.pool.query(
      `UPDATE users SET locked_until = now() + interval '100 seconds' WHERE id = $1`,
      [user.id],
    );

    const response = await loginRequest(ctx.app, user.email, user.password);
    const seconds = (errorOf(response).details as { retry_after_seconds: number })
      .retry_after_seconds;
    expect(seconds).toBeGreaterThan(90);
    expect(seconds).toBeLessThanOrEqual(100);
  });

  it('after 15 minutes the account is active again by itself, with no process involved (C-17)', async () => {
    const user = await registerStudent(ctx.app);
    await fail(user, 5);
    await ctx.pool.query(
      `UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`,
      [user.id],
    );

    const response = await loginRequest(ctx.app, user.email, user.password);
    expect(response.statusCode).toBe(200);
    expect(await userRow(ctx.pool, user.id)).toMatchObject({
      failed_login_attempts: 0,
      locked_until: null,
    });
  });

  it('after the lock expires the count starts again from zero: one failure does not lock again', async () => {
    const user = await registerStudent(ctx.app);
    await fail(user, 5);
    await ctx.pool.query(
      `UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`,
      [user.id],
    );

    const response = await loginRequest(ctx.app, user.email, 'gresita999');
    expect(response.statusCode).toBe(401);
    expect(errorOf(response).code).toBe('INVALID_CREDENTIALS');
    expect(await userRow(ctx.pool, user.id)).toMatchObject({
      failed_login_attempts: 1,
      locked_until: null,
    });
  });

  it('only CONSECUTIVE failures count: a success in between resets the count', async () => {
    const user = await registerStudent(ctx.app);
    await fail(user, 4);
    expect((await loginRequest(ctx.app, user.email, user.password)).statusCode).toBe(200);
    const responses = await fail(user, 4);
    expect(responses.map((r) => r.statusCode)).toEqual([401, 401, 401, 401]);
    expect((await userRow(ctx.pool, user.id))!.locked_until).toBeNull();
  });

  it('the count is per account: other accounts are not affected', async () => {
    const victim = await registerStudent(ctx.app);
    const other = await registerStudent(ctx.app);
    await fail(victim, 5);
    expect((await loginRequest(ctx.app, other.email, other.password)).statusCode).toBe(200);
    expect((await userRow(ctx.pool, other.id))!.failed_login_attempts).toBe(0);
  });

  it('counts attempts for the same account whatever the case or spacing of the e-mail', async () => {
    const user = await registerStudent(ctx.app);
    const variants = [
      user.email,
      user.email.toUpperCase(),
      ` ${user.email}`,
      `${user.email} `,
      user.email,
    ];
    const statuses = [];
    for (const email of variants)
      statuses.push((await loginRequest(ctx.app, email, 'gresita123')).statusCode);
    expect(statuses).toEqual([401, 401, 401, 401, 429]);
  });

  it('an address without an account is never "locked": it keeps answering 401 (Q35)', async () => {
    const email = uniqueEmail('nobody');
    const statuses = [];
    for (let i = 0; i < 7; i += 1)
      statuses.push((await loginRequest(ctx.app, email, 'gresita123')).statusCode);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401]);
  });

  it('a locked account keeps its existing sessions (the lock is about logging in)', async () => {
    const user = await registerStudent(ctx.app);
    await fail(user, 5);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: user.headers,
    });
    expect(me.statusCode).toBe(200);
  });

  it('the lock survives a restart: it is stored on the account, not in memory (C-17)', async () => {
    const user = await registerStudent(ctx.app);
    await fail(user, 5);
    const restarted = await buildAuthTestApp();
    try {
      expect((await loginRequest(restarted.app, user.email, user.password)).statusCode).toBe(429);
    } finally {
      await restarted.close();
    }
  });

  it('the number of attempts and the duration come from configuration', async () => {
    const strict = await buildAuthTestApp({
      AUTH_MAX_FAILED_ATTEMPTS: '2',
      AUTH_LOCK_MINUTES: '1',
    });
    try {
      const user = await registerStudent(strict.app);
      expect((await loginRequest(strict.app, user.email, 'gresita123')).statusCode).toBe(401);
      const second = await loginRequest(strict.app, user.email, 'gresita123');
      expect(second.statusCode).toBe(429);
      const seconds = (errorOf(second).details as { retry_after_seconds: number })
        .retry_after_seconds;
      expect(seconds).toBeGreaterThan(50);
      expect(seconds).toBeLessThanOrEqual(60);
    } finally {
      await strict.close();
    }
  });

  it('five simultaneous wrong attempts cannot slip past the count', async () => {
    const user = await registerStudent(ctx.app);
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => loginRequest(ctx.app, user.email, `gresita${i}00`)),
    );
    const row = (await userRow(ctx.pool, user.id))!;
    expect(row.failed_login_attempts).toBe(5);
    expect(row.locked_until).not.toBeNull();
  });
});
