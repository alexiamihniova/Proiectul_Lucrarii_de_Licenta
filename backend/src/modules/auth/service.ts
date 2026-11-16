import { createHash, randomBytes } from 'node:crypto';
import type { UserActor } from '../../core/actor.js';
import { AppError } from '../../core/errors.js';
import { auditLog } from '../../core/logger.js';
import type { WorkerTask } from '../../core/worker.js';
import { toCsv, zipStored } from './export-files.js';
import {
  assertPasswordFitsBcrypt,
  hashPassword,
  needsRehash,
  passwordPolicyIssues,
  verifyPassword,
} from './password.js';
import type { FieldIssue } from './password.js';
import { STUDY_DATA_COLUMNS, createAuthRepository, readStudyData } from './repository.js';
import { EmailInput } from './schemas.js';
import {
  fingerprintMatches,
  passwordFingerprint,
  signSessionToken,
  verifySessionToken,
} from './session-token.js';
import { GDPR_CONSENT_VERSION, RESET_PASSWORD_PATH, RESET_TOKEN_BYTES } from './types.js';
import type {
  AuthService,
  AuthServiceDeps,
  IssuedSession,
  PublicUser,
  UserFileStore,
  UserRecord,
} from './types.js';

/**
 * Public surface of the auth module (Segment 1). Other modules import ONLY from this file.
 *
 * Specification: docs/design/auth.md. Contract: the tests in backend/tests/auth/.
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
  GDPR_CONSENT_VERSION,
  PASSWORD_FINGERPRINT_BYTES,
  PASSWORD_FINGERPRINT_PREFIX,
  PASSWORD_MAX_BYTES,
  RESET_PASSWORD_PATH,
  RESET_TOKEN_BYTES,
} from './types.js';
export { registerAuthHooks } from './hooks.js';

const HOUR_MS = 3_600_000;

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    created_at: user.createdAt.toISOString(),
  };
}

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const { config, log } = deps;
  const repository = createAuthRepository(deps.db);
  const now = deps.now ?? (() => new Date());
  const secret = config.session.secret;
  const cost = config.auth.bcryptCost;

  /**
   * Design 1.4: an unknown address still costs one bcrypt comparison, so the response time
   * does not tell whether the address has an account. Computed once, on first use.
   */
  let dummyHash: Promise<string> | undefined;
  const burnOneComparison = async (password: string) => {
    dummyHash ??= hashPassword(randomBytes(18).toString('base64'), cost);
    await verifyPassword(password, await dummyHash);
  };

  function issueSession(user: UserRecord): IssuedSession {
    const iat = Math.floor(now().getTime() / 1000);
    const exp = iat + config.session.ttlHours * 3600;
    const token = signSessionToken(secret, {
      sub: String(user.id),
      iat,
      exp,
      pfp: passwordFingerprint(secret, user.passwordHash),
    });
    return {
      response: { user: toPublicUser(user), expires_at: new Date(exp * 1000).toISOString() },
      token,
    };
  }

  /** Shared by registration and `admin:create`: same policy, same storage (design 1). */
  async function createAccount(
    email: string,
    password: string,
    role: 'student' | 'admin',
    issues: FieldIssue[],
  ): Promise<UserRecord> {
    const problems = [...issues, ...passwordPolicyIssues(password)];
    if (problems.length > 0) throw new AppError('INVALID_REGISTRATION_DATA', problems);
    assertPasswordFitsBcrypt(password);
    const user = await repository.createUser({
      email,
      passwordHash: await hashPassword(password, cost),
      role,
      gdprConsentAt: now(),
      gdprConsentVersion: GDPR_CONSENT_VERSION,
    });
    if (!user) throw new AppError('EMAIL_ALREADY_EXISTS');
    return user;
  }

  /** Design 5: the database first, then the files; a file error does not undo the deletion. */
  async function removeAccount(userId: number, deletedBy: number): Promise<void> {
    await repository.deleteUser(userId);
    try {
      await deps.userFiles.deleteAllForUser(userId);
    } catch (error) {
      log.error({ err: error, user_id: userId }, 'the files of a deleted account were not removed');
    }
    auditLog(log, { action: 'account.deleted', actor_id: deletedBy, target: { user_id: userId } });
  }

  function requireAdmin(actor: UserActor): void {
    if (actor.role !== 'admin') throw new AppError('FORBIDDEN');
  }

  return {
    async register(input) {
      const issues: FieldIssue[] =
        input.password === input.passwordConfirmation
          ? []
          : [{ path: 'body/password_confirmation', message: 'must equal the password' }];
      const user = await createAccount(input.email, input.password, 'student', issues);
      auditLog(log, { action: 'account.registered', actor_id: user.id });
      return issueSession(user);
    },

    // Design 3.2; the step numbers are the ones used there.
    async login({ email, password }) {
      const found = await repository.findUserByEmail(email);
      if (!found) {
        await burnOneComparison(password); // step 2
        auditLog(log, { action: 'auth.login_failed', actor_id: null, result: 'failure' });
        throw new AppError('INVALID_CREDENTIALS');
      }
      let user = found;
      const current = now();

      if (user.lockedUntil && user.lockedUntil > current) {
        // Step 3: the password is not checked and the counter does not move.
        const seconds = Math.ceil((user.lockedUntil.getTime() - current.getTime()) / 1000);
        throw new AppError('ACCOUNT_TEMPORARILY_LOCKED', {
          retry_after_seconds: Math.min(Math.max(seconds, 1), config.auth.lockMinutes * 60),
        });
      }
      // Step 4: a lock that has ended starts a new count.
      if (user.lockedUntil) await repository.clearLoginFailures(user.id);

      if (!(await verifyPassword(password, user.passwordHash))) {
        // Step 5.
        const attempts = await repository.incrementFailedLogins(user.id);
        auditLog(log, {
          action: 'auth.login_failed',
          actor_id: null,
          target: { user_id: user.id },
          result: 'failure',
        });
        if (attempts >= config.auth.maxFailedAttempts) {
          const seconds = config.auth.lockMinutes * 60;
          await repository.setLockedUntil(user.id, new Date(current.getTime() + seconds * 1000));
          auditLog(log, {
            action: 'auth.account_locked',
            actor_id: null,
            target: { user_id: user.id },
          });
          throw new AppError('ACCOUNT_TEMPORARILY_LOCKED', { retry_after_seconds: seconds });
        }
        throw new AppError('INVALID_CREDENTIALS');
      }

      // Step 6. A blocked account learns it only with the correct password (Q36).
      if (user.status === 'blocked') throw new AppError('ACCOUNT_BLOCKED');
      if (needsRehash(user.passwordHash, cost)) {
        // Before the cookie is issued: the new hash changes the session fingerprint (1.3).
        const passwordHash = await hashPassword(password, cost);
        await repository.setPasswordHash(user.id, passwordHash);
        user = { ...user, passwordHash };
      } else if (user.failedLoginAttempts > 0 || user.lockedUntil) {
        await repository.clearLoginFailures(user.id);
      }
      auditLog(log, { action: 'auth.login_succeeded', actor_id: user.id });
      return issueSession(user);
    },

    // Design 2.3, steps 1–7.
    async authenticate(cookieValue) {
      const unauthenticated = { ok: false, reason: 'unauthenticated' } as const;
      if (!cookieValue) return unauthenticated;
      const claims = verifySessionToken(secret, cookieValue, now());
      if (!claims) return unauthenticated;
      const user = await repository.findUserById(claims.userId); // read on every request
      if (!user) return unauthenticated;
      if (!fingerprintMatches(secret, user.passwordHash, claims.pfp)) return unauthenticated;
      if (user.status !== 'active') return { ok: false, reason: 'blocked' };
      return {
        ok: true,
        user: { id: user.id, role: user.role, email: user.email },
        expiresAt: claims.expiresAt,
      };
    },

    // Design 4.1. Nothing here may tell the caller whether the address has an account.
    async requestPasswordReset(email) {
      const user = await repository.findUserByEmail(email);
      if (!user || user.status !== 'active') return;
      const current = now();
      const recent = await repository.countResetTokensCreatedSince(
        user.id,
        new Date(current.getTime() - HOUR_MS),
      );
      if (recent >= config.auth.resetRequestsPerHour) return;

      // The token exists only here, in memory, and in the e-mail; the database gets its hash.
      const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
      const expiresAt = new Date(current.getTime() + config.auth.resetTtlMinutes * 60_000);
      await repository.createResetToken({
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt,
      });
      auditLog(log, {
        action: 'auth.password_reset_requested',
        actor_id: null,
        target: { user_id: user.id },
      });
      try {
        await deps.sendPasswordResetEmail({
          to: user.email,
          resetUrl: `${new URL(config.appBaseUrl).origin}${RESET_PASSWORD_PATH}?token=${token}`,
          expiresAt,
        });
      } catch {
        // The error object is not logged: a mailer error may quote the message it failed to send.
        log.error({ user_id: user.id }, 'the password reset e-mail could not be sent');
      }
    },

    // Design 4.2.
    async confirmPasswordReset({ token, password }) {
      const problems = passwordPolicyIssues(password);
      if (problems.length > 0) throw new AppError('VALIDATION_ERROR', problems);
      assertPasswordFitsBcrypt(password); // refused before the link is used up
      const current = now();

      const userId = await repository.transaction(async (tx) => {
        // One UPDATE … RETURNING: two confirmations with the same link cannot both get the row.
        const used = await tx.consumeResetToken(sha256Hex(token), current);
        if (!used) return null;
        await tx.setPasswordHash(used.userId, await hashPassword(password, cost)); // also Q38
        await tx.invalidateResetTokens(used.userId, current); // Q39
        return used.userId;
      });

      if (userId === null) {
        auditLog(log, {
          action: 'auth.password_reset_rejected',
          actor_id: null,
          result: 'failure',
        });
        throw new AppError('RESET_TOKEN_INVALID');
      }
      auditLog(log, { action: 'auth.password_reset_completed', actor_id: userId });
    },

    purgeResetTokens: () => repository.purgeResetTokens(now()),

    getPreferences: (actor) => repository.getPreferences(actor),
    updatePreferences: (actor, changes) => repository.updatePreferences(actor, changes),

    // Design 5.4.
    async exportAccount(actor, format) {
      const user = await repository.findUserById(actor.userId);
      if (!user) throw new AppError('UNAUTHENTICATED');
      const data = await readStudyData(deps.db, actor);
      const current = now();
      const name = `recap-export-${current.toISOString().slice(0, 10)}`;
      auditLog(log, { action: 'account.exported', actor_id: actor.userId, target: { format } });

      if (format === 'csv') {
        const sets = Object.keys(STUDY_DATA_COLUMNS) as (keyof typeof STUDY_DATA_COLUMNS)[];
        return {
          contentType: 'application/zip',
          filename: `${name}.zip`,
          body: zipStored(
            sets.map((set) => ({
              name: `${set}.csv`,
              content: toCsv(STUDY_DATA_COLUMNS[set], data[set]),
            })),
          ),
        };
      }
      return {
        contentType: 'application/json',
        filename: `${name}.json`,
        body: {
          exported_at: current.toISOString(),
          user: {
            ...toPublicUser(user),
            gdpr_consent_at: user.gdprConsentAt.toISOString(),
            gdpr_consent_version: user.gdprConsentVersion,
          },
          preferences: await repository.getPreferences(actor),
          ...data,
        },
      };
    },

    // Design 5.1. A wrong password here does not count towards the login lock.
    async deleteOwnAccount(actor, password) {
      const user = await repository.findUserById(actor.userId);
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throw new AppError('PASSWORD_CONFIRMATION_FAILED');
      }
      await removeAccount(user.id, actor.userId);
    },

    async listUsers(actor, query) {
      requireAdmin(actor);
      const { items, total } = await repository.listUsers(query);
      return {
        items: items.map((user) => ({
          ...toPublicUser(user),
          document_count: user.documentCount,
        })),
        total,
      };
    },

    // Design 5.3 (Q37): administrator accounts are not managed through the service.
    async setUserStatus(actor, userId, status) {
      requireAdmin(actor);
      const user = await repository.findUserById(userId);
      if (!user) throw new AppError('NOT_FOUND');
      if (user.role === 'admin' || user.status === status) throw new AppError('CONFLICT');
      await repository.setStatus(userId, status);
      auditLog(log, {
        action: status === 'blocked' ? 'account.blocked' : 'account.unblocked',
        actor_id: actor.userId,
        target: { user_id: userId },
      });
      return toPublicUser({ ...user, status });
    },

    async deleteUser(actor, userId) {
      requireAdmin(actor);
      const user = await repository.findUserById(userId);
      if (!user) throw new AppError('NOT_FOUND');
      if (user.role === 'admin') throw new AppError('CONFLICT');
      await removeAccount(userId, actor.userId);
    },

    async createAdmin(input) {
      const email = EmailInput.safeParse(input.email);
      const issues: FieldIssue[] = email.success
        ? []
        : [{ path: 'body/email', message: 'must be a valid e-mail address' }];
      const user = await createAccount(email.data ?? '', input.password, 'admin', issues);
      auditLog(log, { action: 'admin.created', actor_id: null, target: { user_id: user.id } });
      return toPublicUser(user);
    },

    async getUserById(userId) {
      const user = await repository.findUserById(userId);
      return user ? toPublicUser(user) : null;
    },
  };
}

/** Background tasks of the module: purge expired or used reset tokens, once an hour. */
export function authWorkerTasks(service: AuthService): WorkerTask[] {
  return [
    {
      name: 'auth:purge-reset-tokens',
      intervalMs: HOUR_MS,
      run: async () => {
        await service.purgeResetTokens();
      },
    },
  ];
}

/**
 * Stands in for the file store until Segment 2 provides the real one (Q43): it deletes
 * nothing and says so in the log, so a deleted account's files are not silently forgotten.
 */
export function createPendingUserFileStore(log: {
  warn(obj: object, msg?: string): void;
}): UserFileStore {
  return {
    deleteAllForUser: async (userId) => {
      log.warn(
        { user_id: userId },
        'uploaded files of the deleted account were NOT removed: no file store yet (Segment 2)',
      );
    },
  };
}
