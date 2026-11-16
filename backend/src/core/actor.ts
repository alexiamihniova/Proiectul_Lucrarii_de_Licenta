import type { UserRole } from './domain.js';

/**
 * Who is acting. Every repository function that touches user-owned data takes an actor as its
 * FIRST parameter and filters by `actor.userId` (RNF7; docs/design/auth.md, section 6.3).
 *
 * The types are branded: an object literal is not an actor, so a query cannot be written
 * without one, and the only ways to obtain one are the two functions below. Search the code
 * for `systemActor(` to review every place that acts without a user.
 */

declare const actorBrand: unique symbol;

/** An authenticated user acting on their own data. */
export interface UserActor {
  readonly kind: 'user';
  readonly userId: number;
  readonly role: UserRole;
  readonly [actorBrand]: true;
}

/** The application acting on its own: worker tasks, CLI scripts, migrations of data. */
export interface SystemActor {
  readonly kind: 'system';
  /** Why no user is involved, e.g. `worker:purge-reset-tokens`. Appears in audit lines. */
  readonly reason: string;
  readonly [actorBrand]: true;
}

export type Actor = UserActor | SystemActor;

/** The actor for the authenticated user of a request (`request.user`). */
export function actorFromUser(user: { id: number; role: UserRole }): UserActor {
  return { kind: 'user', userId: user.id, role: user.role } as UserActor;
}

/** An actor for background work. Never use it to serve an HTTP request made by a user. */
export function systemActor(reason: string): SystemActor {
  return { kind: 'system', reason } as SystemActor;
}
