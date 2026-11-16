import bcrypt from 'bcrypt';
import { AppError } from '../../core/errors.js';
import { Password } from './schemas.js';
import { PASSWORD_MAX_BYTES } from './types.js';

/**
 * Password policy and storage (docs/design/auth.md, section 1; ADR-0010).
 * The native `bcrypt` library hashes on the libuv thread pool, outside the event loop.
 */

export interface FieldIssue {
  path: string;
  message: string;
}

/**
 * RF1: 8–64 characters, at least one letter and one digit; the password is never altered.
 * The rule itself is the `Password` schema, so the routes and the service cannot disagree.
 */
export function passwordPolicyIssues(password: string, path = 'body/password'): FieldIssue[] {
  const result = Password.safeParse(password);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path, message: issue.message }));
}

/** bcrypt ignores everything after 72 bytes, so a longer password is refused (Q34). */
export function assertPasswordFitsBcrypt(password: string): void {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new AppError('PASSWORD_TOO_LONG');
  }
}

export function hashPassword(password: string, cost: number): Promise<string> {
  return bcrypt.hash(password, cost);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** True when the stored hash was made with another cost than the configured one (1.3). */
export function needsRehash(hash: string, cost: number): boolean {
  return bcrypt.getRounds(hash) !== cost;
}
