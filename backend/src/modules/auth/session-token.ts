import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SessionClaims } from './types.js';
import { PASSWORD_FINGERPRINT_BYTES, PASSWORD_FINGERPRINT_PREFIX } from './types.js';

/**
 * The session JWT (docs/design/auth.md, 2.2 and 2.3; ADR-0011). HS256 only, written with
 * node:crypto: the format is fixed by the design and by the tests, and the token has four
 * claims, so a JWT library would add a dependency without removing any decision.
 */

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function sign(secret: string, input: string): Buffer {
  return createHmac('sha256', secret).update(input).digest();
}

function equal(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Changes whenever the password hash changes, which is what invalidates the sessions. It is an
 * HMAC with the server secret, truncated: the JWT can be read on the client and must carry
 * nothing derived from the hash that could be used without the secret.
 */
export function passwordFingerprint(secret: string, passwordHash: string): string {
  return createHmac('sha256', secret)
    .update(PASSWORD_FINGERPRINT_PREFIX + passwordHash)
    .digest()
    .subarray(0, PASSWORD_FINGERPRINT_BYTES)
    .toString('base64url');
}

export function fingerprintMatches(secret: string, passwordHash: string, given: string): boolean {
  return equal(Buffer.from(given), Buffer.from(passwordFingerprint(secret, passwordHash)));
}

export function signSessionToken(secret: string, claims: SessionClaims): string {
  const input = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  return `${input}.${sign(secret, input).toString('base64url')}`;
}

/**
 * Steps 1–4 of design 2.3: three parts, `alg: HS256`, a correct signature, `exp` in the
 * future, `sub` a positive integer. Returns `null` for anything else, without saying why.
 */
export function verifySessionToken(
  secret: string,
  token: string,
  now: Date,
): { userId: number; expiresAt: Date; pfp: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const parsedHeader: unknown = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    if ((parsedHeader as { alg?: unknown } | null)?.alg !== 'HS256') return null;
    if (!equal(Buffer.from(signature, 'base64url'), sign(secret, `${header}.${payload}`))) {
      return null;
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<
      Record<keyof SessionClaims, unknown>
    > | null;
    if (!claims || typeof claims !== 'object') return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now.getTime()) return null;
    if (typeof claims.sub !== 'string' || !/^[1-9]\d{0,15}$/.test(claims.sub)) return null;
    if (typeof claims.pfp !== 'string') return null;
    return {
      userId: Number(claims.sub),
      expiresAt: new Date(claims.exp * 1000),
      pfp: claims.pfp,
    };
  } catch {
    return null;
  }
}
