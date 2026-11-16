import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildAuthTestApp, errorOf } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { registerAdmin, registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/** UC-11 „Modifică setările” — RF18, C-23. */
describe('preferences (UC-11, RF18, C-23)', () => {
  let ctx: AuthTestApp;
  beforeAll(async () => void (ctx = await buildAuthTestApp()));
  afterAll(() => ctx.close());

  const DEFAULTS = {
    theme: 'light',
    mascot_enabled: true,
    reminder_time: '18:00',
    reminder_channel: 'in_app',
    daily_goal: 20,
  };

  const get = (user: TestUser) =>
    ctx.app.inject({ method: 'GET', url: '/api/v1/preferences', headers: user.headers });
  const patch = (user: TestUser, payload: object) =>
    ctx.app.inject({ method: 'PATCH', url: '/api/v1/preferences', headers: user.headers, payload });

  it('a new account has the default preferences (Q5)', async () => {
    const response = await get(await registerStudent(ctx.app));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(DEFAULTS);
  });

  it('the reminder time is HH:MM, without seconds', async () => {
    const user = await registerStudent(ctx.app);
    expect((await get(user)).json().reminder_time).toBe('18:00');
    expect((await patch(user, { reminder_time: '07:05' })).json().reminder_time).toBe('07:05');
    expect((await get(user)).json().reminder_time).toBe('07:05');
  });

  it('changes only the fields that are sent and returns all of them', async () => {
    const user = await registerStudent(ctx.app);
    const response = await patch(user, { theme: 'dark', daily_goal: 50 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...DEFAULTS, theme: 'dark', daily_goal: 50 });
    expect((await get(user)).json()).toEqual({ ...DEFAULTS, theme: 'dark', daily_goal: 50 });
  });

  it('accepts every field of RF18', async () => {
    const user = await registerStudent(ctx.app);
    const all = {
      theme: 'dark',
      mascot_enabled: false,
      reminder_time: '23:59',
      reminder_channel: 'both',
      daily_goal: 100,
    };
    expect((await patch(user, all)).json()).toEqual(all);
    expect(
      (
        await patch(user, { reminder_time: '00:00', reminder_channel: 'email', daily_goal: 5 })
      ).json(),
    ).toEqual({
      ...all,
      reminder_time: '00:00',
      reminder_channel: 'email',
      daily_goal: 5,
    });
  });

  it('an empty change is accepted and changes nothing', async () => {
    const user = await registerStudent(ctx.app);
    const response = await patch(user, {});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(DEFAULTS);
  });

  it.each([
    ['daily goal below 5', { daily_goal: 4 }],
    ['daily goal above 100', { daily_goal: 101 }],
    ['daily goal that is not a whole number', { daily_goal: 10.5 }],
    ['unknown theme', { theme: 'blue' }],
    ['unknown channel', { reminder_channel: 'sms' }],
    ['time out of range', { reminder_time: '24:00' }],
    ['time with seconds', { reminder_time: '18:00:00' }],
    ['mascot that is not a boolean', { mascot_enabled: 'yes' }],
  ])('refuses %s with 400 and changes nothing', async (_name, payload) => {
    const user = await registerStudent(ctx.app);
    const response = await patch(user, payload);
    expect(response.statusCode).toBe(400);
    expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    expect((await get(user)).json()).toEqual(DEFAULTS);
  });

  it('a valid field next to an invalid one is not saved either', async () => {
    const user = await registerStudent(ctx.app);
    expect((await patch(user, { theme: 'dark', daily_goal: 1 })).statusCode).toBe(400);
    expect((await get(user)).json().theme).toBe('light');
  });

  it('each user has their own preferences (RNF7)', async () => {
    const a = await registerStudent(ctx.app);
    const b = await registerStudent(ctx.app);
    await patch(a, { theme: 'dark', daily_goal: 77 });
    expect((await get(b)).json()).toEqual(DEFAULTS);
    expect((await get(a)).json().daily_goal).toBe(77);
  });

  it('cannot be aimed at another user: identifiers in the body are ignored', async () => {
    const a = await registerStudent(ctx.app);
    const b = await registerStudent(ctx.app);
    await patch(b, { user_id: a.id, theme: 'dark' });
    expect((await get(a)).json().theme).toBe('light');
    expect((await get(b)).json().theme).toBe('dark');
  });

  it('an administrator has preferences too', async () => {
    const admin = await registerAdmin(ctx.app, ctx.pool);
    expect((await get(admin)).statusCode).toBe(200);
    expect((await patch(admin, { theme: 'dark' })).json().theme).toBe('dark');
  });

  it('needs a session', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/preferences' })).statusCode).toBe(
      401,
    );
    expect(
      (
        await ctx.app.inject({
          method: 'PATCH',
          url: '/api/v1/preferences',
          payload: { theme: 'dark' },
        })
      ).statusCode,
    ).toBe(401);
  });
});
