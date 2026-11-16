import type { Config } from '../../core/config.js';

/**
 * The session cookie (docs/design/auth.md, 2.1):
 * `Path=/; HttpOnly; SameSite=Lax; Max-Age=<ttl>` and `Secure` in production.
 * The value is the JWT: it goes only into `Set-Cookie`, never into a body or a log line.
 */

function attributes(config: Config, maxAgeSeconds: number): string {
  const secure = config.env === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function sessionCookie(config: Config, token: string): string {
  return `${config.session.cookieName}=${token}; ${attributes(config, config.session.ttlHours * 3600)}`;
}

export function clearedSessionCookie(config: Config): string {
  return `${config.session.cookieName}=; ${attributes(config, 0)}`;
}

/** The value of the session cookie in a `Cookie` header, or `undefined` when it is absent. */
export function readSessionCookie(config: Config, header: string | undefined): string | undefined {
  if (!header) return undefined;
  const prefix = `${config.session.cookieName}=`;
  for (const part of header.split(';')) {
    const pair = part.trim();
    if (pair.startsWith(prefix)) return pair.slice(prefix.length);
  }
  return undefined;
}
