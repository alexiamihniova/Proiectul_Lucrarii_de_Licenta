import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFromUser } from '../../src/core/actor.js';
import { buildAuthTestApp } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import {
  loginRequest,
  registerAdmin,
  registerStudent,
  sessionCookie,
  uniqueEmail,
  userRow,
} from '../helpers/session.js';

/**
 * What is logged and what must never be (SRS 2.4 row 5, 3.6.3; RNF6).
 * Design: docs/design/auth.md, section 7.
 */
describe('logging and audit (SRS 3.6.3)', () => {
  let ctx: AuthTestApp;
  const secrets: { name: string; value: string }[] = [];
  let userId: number;
  let adminId: number;
  let deletedByAdminId: number;

  const audit = (action: string) => ctx.auditEvents().filter((event) => event.action === action);

  beforeAll(async () => {
    ctx = await buildAuthTestApp();
    const email = uniqueEmail('jurnal');
    const password = 'ParolaSecreta77';
    const newPassword = 'ParolaNoua88secret';

    // Every account flow, once.
    const user = await registerStudent(ctx.app, { email, password });
    userId = user.id;
    secrets.push(
      { name: 'password', value: password },
      { name: 'session token', value: user.token },
    );
    secrets.push({ name: 'token signature', value: user.token.split('.')[2]! });
    secrets.push({
      name: 'password hash',
      value: (await userRow(ctx.pool, user.id))!.password_hash,
    });
    secrets.push({ name: 'e-mail address', value: email });

    await loginRequest(ctx.app, email, 'GresitaSecreta11');
    secrets.push({ name: 'wrong password', value: 'GresitaSecreta11' });
    await loginRequest(ctx.app, uniqueEmail('necunoscut-secret'), password);
    const login = await loginRequest(ctx.app, email, password);
    secrets.push({ name: 'second session token', value: sessionCookie(ctx.app, login)!.value });

    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/preferences',
      headers: user.headers,
      payload: { theme: 'dark' },
    });
    await ctx.app.inject({ method: 'GET', url: '/api/v1/account/export', headers: user.headers });
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: user.headers });

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email },
    });
    const resetUrl = ctx.mail[0]!.resetUrl;
    const token = new URL(resetUrl).searchParams.get('token')!;
    secrets.push({ name: 'reset token', value: token }, { name: 'reset link', value: resetUrl });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: {
        token: 'TokenGresitSecret999',
        password: newPassword,
        password_confirmation: newPassword,
      },
    });
    secrets.push({ name: 'wrong reset token', value: 'TokenGresitSecret999' });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/confirm',
      payload: { token, password: newPassword, password_confirmation: newPassword },
    });
    secrets.push({ name: 'new password', value: newPassword });
    secrets.push({
      name: 'new password hash',
      value: (await userRow(ctx.pool, user.id))!.password_hash,
    });

    for (let i = 0; i < 5; i += 1) await loginRequest(ctx.app, email, 'GresitaSecreta11');
    await ctx.pool.query(
      'UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = $1',
      [user.id],
    );

    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email, password: newPassword },
    });

    const admin = await registerAdmin(ctx.app, ctx.pool);
    adminId = admin.id;
    const victim = await registerStudent(ctx.app);
    deletedByAdminId = victim.id;
    const actor = actorFromUser({ id: admin.id, role: 'admin' });
    await ctx.app.auth.setUserStatus(actor, victim.id, 'blocked');
    await ctx.app.auth.setUserStatus(actor, victim.id, 'active');
    await ctx.app.auth.deleteUser(actor, victim.id);

    const again = await loginRequest(ctx.app, email, newPassword);
    const cookie = sessionCookie(ctx.app, again)!;
    secrets.push({ name: 'third session token', value: cookie.value });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/account/delete',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
      payload: { password: newPassword },
    });
  });
  afterAll(() => ctx.close());

  it('the flows above did write to the log', () => {
    expect(ctx.logs.length).toBeGreaterThan(20);
    expect(ctx.auditEvents().length).toBeGreaterThan(10);
  });

  it('no log line contains a password, a hash, a session token, a reset token or link, or an e-mail address', () => {
    const everything = ctx.logs.join('\n');
    for (const secret of secrets) {
      expect(everything.includes(secret.value), `${secret.name} found in the log`).toBe(false);
    }
    expect(everything).not.toContain(ctx.config.session.secret);
    expect(everything).not.toContain('necunoscut-secret');
  });

  it('request lines do not carry cookies or request bodies', () => {
    for (const line of ctx.logs) {
      expect(line).not.toMatch(/"cookie":"(?!\[redacted\])/i);
      expect(line).not.toMatch(/"set-cookie":"?(?!\[redacted\])\w/i);
      expect(line).not.toContain('password_confirmation');
    }
  });

  it('every audit event has the common fields', () => {
    for (const event of ctx.auditEvents()) {
      expect(event).toMatchObject({ audit: true });
      expect(typeof event.action).toBe('string');
      expect(['success', 'failure']).toContain(event.result);
      expect(event).toHaveProperty('actor_id');
      expect(typeof event.time === 'number' || typeof event.time === 'string').toBe(true);
    }
  });

  it.each([
    ['account.registered', 'success'],
    ['auth.login_succeeded', 'success'],
    ['auth.logout', 'success'],
    ['account.exported', 'success'],
    ['auth.password_reset_completed', 'success'],
  ])('%s is recorded with the user as the actor', (action, result) => {
    const events = audit(action).filter((event) => event.actor_id === userId);
    expect(events.length, action).toBeGreaterThanOrEqual(1);
    expect(events[0]!.result).toBe(result);
  });

  it('a failed login is recorded as a failure, naming the account only by id (SRS 3.6.3)', () => {
    const known = audit('auth.login_failed').filter(
      (event) => (event.target as { user_id?: number } | undefined)?.user_id === userId,
    );
    expect(known.length).toBeGreaterThanOrEqual(1);
    expect(known[0]).toMatchObject({ result: 'failure', actor_id: null });

    const unknown = audit('auth.login_failed').filter(
      (event) => (event.target as { user_id?: number } | undefined)?.user_id === undefined,
    );
    expect(unknown.length).toBeGreaterThanOrEqual(1); // the address without an account
  });

  it('the lock after 5 failures is recorded', () => {
    const events = audit('auth.account_locked');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_id: null, target: { user_id: userId } });
  });

  it('reset requests and rejected links are recorded without the token', () => {
    expect(audit('auth.password_reset_requested')[0]).toMatchObject({
      target: { user_id: userId },
    });
    expect(audit('auth.password_reset_rejected')[0]).toMatchObject({
      result: 'failure',
      actor_id: null,
    });
  });

  it('a refused cross-site request is recorded', () => {
    expect(audit('auth.origin_rejected').length).toBeGreaterThanOrEqual(1);
  });

  it('account deletion is recorded with who did it (SRS 2.4 row 5)', () => {
    const events = audit('account.deleted');
    expect(events).toContainEqual(
      expect.objectContaining({ actor_id: userId, target: { user_id: userId }, result: 'success' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ actor_id: adminId, target: { user_id: deletedByAdminId } }),
    );
  });

  it('the administrator’s block and unblock are recorded with the administrator as the actor', () => {
    expect(audit('account.blocked')[0]).toMatchObject({
      actor_id: adminId,
      target: { user_id: deletedByAdminId },
    });
    expect(audit('account.unblocked')[0]).toMatchObject({
      actor_id: adminId,
      target: { user_id: deletedByAdminId },
    });
  });

  it('a rate-limited request is recorded', async () => {
    const limited = await buildAuthTestApp({ RATE_LIMIT_AUTH_MAX: '1' });
    try {
      await loginRequest(limited.app, 'nobody@example.com', 'parola123');
      await loginRequest(limited.app, 'nobody@example.com', 'parola123');
      const events = limited.auditEvents().filter((event) => event.action === 'auth.rate_limited');
      expect(events).toHaveLength(1);
      expect(limited.logs.join('\n')).not.toContain('nobody@example.com');
    } finally {
      await limited.close();
    }
  });
});
