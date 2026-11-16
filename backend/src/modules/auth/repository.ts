import type { Database } from '../../db/client.js';
import type { AuthRepository } from './types.js';

/**
 * Queries on `users`, `preferences`, `password_reset_tokens` — the only code that touches
 * these tables. Segment 1B implements `AuthRepository` (./types.ts) here with Drizzle.
 */
export function createAuthRepository(_db: Database): AuthRepository {
  throw new Error('auth repository: not implemented (Segment 1B)');
}
