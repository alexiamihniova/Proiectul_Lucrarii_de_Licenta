import type { FastifyInstance } from 'fastify';
import { AppError } from '../../core/errors.js';
import type { WorkerTask } from '../../core/worker.js';
import type { AuthService, AuthServiceDeps } from './types.js';

/**
 * Public surface of the auth module (Segment 1). Other modules import ONLY from this file.
 *
 * Specification: docs/design/auth.md. Contract: the tests in backend/tests/auth/.
 * Segment 1A defined the interfaces (./types.ts) and the three entry points below; Segment 1B
 * replaces their bodies. The signatures are part of the contract and must not change.
 *
 * What the other modules use:
 *  - `request.user` / `request.actor`, set by the hook (every module);
 *  - `AuthService.listUsers` / `setUserStatus` / `deleteUser` (admin, UC-13);
 *  - `AuthService.getPreferences`, `getUserById` (reminders);
 *  - `authWorkerTasks` (src/worker.ts).
 *
 * auth imports NO other module: what it needs from them (sending the reset e-mail, deleting
 * uploaded files) arrives as functions in `AuthServiceDeps`, wired in src/app.ts.
 */
export type * from './types.js';
export {
  PASSWORD_FINGERPRINT_BYTES,
  PASSWORD_FINGERPRINT_PREFIX,
  PASSWORD_MAX_BYTES,
  RESET_PASSWORD_PATH,
  RESET_TOKEN_BYTES,
} from './types.js';

/** Builds the service. Segment 1B: implement with ./repository.ts. */
export function createAuthService(_deps: AuthServiceDeps): AuthService {
  throw new AppError('NOT_IMPLEMENTED');
}

/**
 * Registers, on the given scope (the `/api/v1` plugin in src/app.ts), the ONE `onRequest` hook
 * of design 6.1: origin check → per-IP rate limit on the public account routes → session
 * check → role check. Decorates `request.user` and `request.actor`. The rate-limit counters
 * belong to this app instance, not to the module.
 */
export function registerAuthHooks(_app: FastifyInstance, _service: AuthService): void {
  throw new AppError('NOT_IMPLEMENTED');
}

/** Background tasks of the module: purge expired or used reset tokens, once an hour. */
export function authWorkerTasks(_service: AuthService): WorkerTask[] {
  throw new AppError('NOT_IMPLEMENTED');
}
