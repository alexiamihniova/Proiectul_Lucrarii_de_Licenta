import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';

/**
 * Sessions for tests. EVERY segment uses this file to act as a student or an administrator;
 * nobody builds cookies or inserts users by hand.
 */

export const DEFAULT_PASSWORD = 'parola123';

export interface ParsedCookie {
  name: string;
  value: string;
  /** Attribute names in lower case → value (`true` for flags such as HttpOnly). */
  attributes: Record<string, string | true>;
  raw: string;
}

/** All Set-Cookie headers of a response, parsed. */
export function setCookies(response: LightMyRequestResponse): ParsedCookie[] {
  const header = response.headers['set-cookie'];
  const list = header === undefined ? [] : Array.isArray(header) ? header : [String(header)];
  return list.map((raw) => {
    const [pair = '', ...rest] = raw.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    const attributes: Record<string, string | true> = {};
    for (const attribute of rest) {
      const index = attribute.indexOf('=');
      if (index === -1) attributes[attribute.toLowerCase()] = true;
      else attributes[attribute.slice(0, index).toLowerCase()] = attribute.slice(index + 1);
    }
    return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes, raw };
  });
}

/** The session cookie set by a response, or `undefined`. */
export function sessionCookie(
  app: FastifyInstance,
  response: LightMyRequestResponse,
): ParsedCookie | undefined {
  return setCookies(response).find((cookie) => cookie.name === app.config.session.cookieName);
}

/** True when the response tells the browser to forget the session cookie. */
export function clearsSession(app: FastifyInstance, response: LightMyRequestResponse): boolean {
  const cookie = sessionCookie(app, response);
  if (!cookie) return false;
  const maxAge = cookie.attributes['max-age'];
  const expires = cookie.attributes['expires'];
  const expired =
    maxAge === '0' || (typeof expires === 'string' && new Date(expires).getTime() <= Date.now());
  return cookie.value === '' && expired;
}

export interface TestUser {
  id: number;
  email: string;
  password: string;
  /** The JWT. */
  token: string;
  /** Spread into `app.inject({ ..., headers: user.headers })`. */
  headers: { cookie: string };
}

let counter = 0;

/** A unique address, so tests never collide. */
export function uniqueEmail(prefix = 'student'): string {
  counter += 1;
  return `${prefix}.${process.pid}.${Date.now()}.${counter}@example.com`;
}

function toTestUser(
  app: FastifyInstance,
  response: LightMyRequestResponse,
  email: string,
  password: string,
): TestUser {
  const cookie = sessionCookie(app, response);
  if (!cookie || cookie.value === '') {
    throw new Error(`no session cookie in response ${response.statusCode}: ${response.body}`);
  }
  const body = response.json() as { user: { id: number; email: string } };
  return {
    id: body.user.id,
    email: body.user.email,
    password,
    token: cookie.value,
    headers: { cookie: `${cookie.name}=${cookie.value}` },
  };
}

/** Registers a student through the API (UC-01) and returns their session. */
export async function registerStudent(
  app: FastifyInstance,
  overrides: { email?: string; password?: string } = {},
): Promise<TestUser> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? DEFAULT_PASSWORD;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, password, password_confirmation: password, gdpr_consent: true },
  });
  if (response.statusCode !== 201) {
    throw new Error(`registration failed with ${response.statusCode}: ${response.body}`);
  }
  return toTestUser(app, response, email, password);
}

export function loginRequest(app: FastifyInstance, email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
}

/** Logs in through the API (UC-02) and returns the session. */
export async function login(
  app: FastifyInstance,
  email: string,
  password: string = DEFAULT_PASSWORD,
): Promise<TestUser> {
  const response = await loginRequest(app, email, password);
  if (response.statusCode !== 200) {
    throw new Error(`login failed with ${response.statusCode}: ${response.body}`);
  }
  return toTestUser(app, response, email, password);
}

/**
 * An administrator session. Administrators cannot be created through the API (design 6.2), so
 * this registers a student and changes the role in the database; the role is read from the
 * database on every request, so the same cookie is an administrator's from then on.
 */
export async function registerAdmin(app: FastifyInstance, pool: pg.Pool): Promise<TestUser> {
  const user = await registerStudent(app, { email: uniqueEmail('admin') });
  await pool.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [user.id]);
  return user;
}

export async function userRow(pool: pg.Pool, userId: number) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return rows[0] as
    | {
        id: string;
        email: string;
        password_hash: string;
        role: string;
        status: string;
        gdpr_consent_at: Date;
        failed_login_attempts: number;
        locked_until: Date | null;
        created_at: Date;
      }
    | undefined;
}

/**
 * Sessions for suites that must pass both before and after the auth module exists (the
 * foundation's contract tests). While /auth/me still answers 501 there is no hook and no way
 * to log in, so it returns nothing and requests go out without a cookie.
 */
export async function sessionsIfAuthExists(
  app: FastifyInstance,
  pool: pg.Pool,
): Promise<{ student?: TestUser; admin?: TestUser }> {
  const probe = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
  if (probe.statusCode === 501) return {};
  return { student: await registerStudent(app), admin: await registerAdmin(app, pool) };
}
