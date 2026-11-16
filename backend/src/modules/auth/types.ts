import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { UserActor } from '../../core/actor.js';
import type { Config } from '../../core/config.js';
import type { UserRole, UserStatus } from '../../core/domain.js';
import type { Database } from '../../db/client.js';
import type {
  AccountExport,
  Preferences,
  PreferencesUpdate,
  SessionResponse,
  User,
} from './schemas.js';

/**
 * Interfaces and types of the auth module. Specification: docs/design/auth.md.
 * Segment 1B implements them WITHOUT changing their shape; the tests in tests/auth/ rely on it.
 */

// --- request context ------------------------------------------------------------------------

/** What every other module reads from `request.user`. */
export interface AuthenticatedUser {
  id: number;
  role: UserRole;
  email: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The auth service of this application instance. Decorated in src/app.ts (Segment 1B). */
    auth: AuthService;
  }
  interface FastifyRequest {
    /** The authenticated, active user; `null` on public routes. Set by the auth hook. */
    user: AuthenticatedUser | null;
    /** `actorFromUser(request.user)`; `null` on public routes. Pass it to services. */
    actor: UserActor | null;
  }
}

// --- ports: what auth needs from outside, injected through AppDependencies ------------------

export interface PasswordResetEmail {
  /** Normalised address of the account. */
  to: string;
  /** `${APP_BASE_URL}/reset-password?token=<token>` — contains the secret token. */
  resetUrl: string;
  expiresAt: Date;
}

/**
 * Sends the reset link (RF2). Implemented by the reminders module (Segment 8); auth never
 * imports that module — src/app.ts passes the function in. Must not throw for delivery
 * failures it can handle; if it throws, auth logs the failure (without the link) and the
 * request still answers 202.
 */
export type SendPasswordResetEmail = (message: PasswordResetEmail) => Promise<void>;

/** Removes the uploaded files of a deleted account (Q43). Implemented by Segment 2. */
export interface UserFileStore {
  deleteAllForUser(userId: number): Promise<void>;
}

// --- sessions -------------------------------------------------------------------------------

/** Payload of the session JWT (design 2.2). Nothing else may be added without an ADR. */
export interface SessionClaims {
  /** User id, as a string. */
  sub: string;
  /** Issued at, seconds since the epoch. */
  iat: number;
  /** Expires at, seconds since the epoch: iat + SESSION_TTL_HOURS × 3600. */
  exp: number;
  /**
   * Password fingerprint: base64url of the first 16 bytes of
   * HMAC-SHA256(key = SESSION_SECRET, message = "recap:pfp:v1:" + password_hash). 22 characters.
   */
  pfp: string;
}

export const PASSWORD_FINGERPRINT_PREFIX = 'recap:pfp:v1:';
export const PASSWORD_FINGERPRINT_BYTES = 16;
/** bcrypt ignores input after 72 bytes (ADR-0010). */
export const PASSWORD_MAX_BYTES = 72;
export const RESET_TOKEN_BYTES = 32;
/** Frontend path of the reset screen; the token goes in the `token` query parameter. */
export const RESET_PASSWORD_PATH = '/reset-password';

/** A new session: the body to return and the cookie value to set. */
export interface IssuedSession {
  response: z.output<typeof SessionResponse>;
  /** The signed JWT. Goes ONLY into the Set-Cookie header; never logged, never in a body. */
  token: string;
}

/** Outcome of checking a session cookie (design 2.3). */
export type AuthenticationResult =
  | { ok: true; user: AuthenticatedUser; expiresAt: Date }
  /** Steps 1–6 failed: missing, malformed, bad signature, expired, unknown user, stale fingerprint. */
  | { ok: false; reason: 'unauthenticated' }
  /** Step 7 failed: the account is blocked by an administrator. */
  | { ok: false; reason: 'blocked' };

// --- repository -----------------------------------------------------------------------------

/** A row of `users`. `passwordHash` never leaves the auth module. */
export interface UserRecord {
  id: number;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  gdprConsentAt: Date;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  createdAt: Date;
}

export interface ResetTokenRecord {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export type PreferencesRecord = z.output<typeof Preferences>;

/**
 * Persistence of `users`, `preferences`, `password_reset_tokens`. The only code that queries
 * these tables. Methods that take a `UserActor` act on that user's own rows only.
 */
export interface AuthRepository {
  /** Runs `work` in one transaction; the repository passed in is bound to it. */
  transaction<T>(work: (repository: AuthRepository) => Promise<T>): Promise<T>;

  // users
  findUserByEmail(normalisedEmail: string): Promise<UserRecord | null>;
  findUserById(userId: number): Promise<UserRecord | null>;
  /**
   * Inserts the user AND its preferences row with the default values (C-23).
   * Returns `null` when the address already has an account (unique index violation).
   */
  createUser(input: {
    email: string;
    passwordHash: string;
    role: UserRole;
    gdprConsentAt: Date;
  }): Promise<UserRecord | null>;
  /** Atomic `failed_login_attempts + 1`; returns the new count. */
  incrementFailedLogins(userId: number): Promise<number>;
  setLockedUntil(userId: number, lockedUntil: Date): Promise<void>;
  /** `failed_login_attempts = 0`, `locked_until = NULL`. */
  clearLoginFailures(userId: number): Promise<void>;
  /** Also clears the login failures (Q38). */
  setPasswordHash(userId: number, passwordHash: string): Promise<void>;
  setStatus(userId: number, status: UserStatus): Promise<void>;
  /** Cascades to everything the user owns; `llm_calls` keep their rows, unlinked (C-20). */
  deleteUser(userId: number): Promise<boolean>;
  listUsers(query: {
    status?: UserStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: (UserRecord & { documentCount: number })[]; total: number }>;

  // preferences
  getPreferences(actor: UserActor): Promise<PreferencesRecord>;
  updatePreferences(
    actor: UserActor,
    changes: z.output<typeof PreferencesUpdate>,
  ): Promise<PreferencesRecord>;

  // password reset tokens
  createResetToken(input: { userId: number; tokenHash: string; expiresAt: Date }): Promise<void>;
  countResetTokensCreatedSince(userId: number, since: Date): Promise<number>;
  /**
   * Marks the token used if it exists, is unused and not expired at `now`, in ONE statement
   * (`UPDATE … WHERE used_at IS NULL AND expires_at > now … RETURNING`), so that two
   * simultaneous confirmations cannot both succeed. Returns the row, or `null`.
   */
  consumeResetToken(tokenHash: string, now: Date): Promise<ResetTokenRecord | null>;
  /** Marks every unused token of the user as used (Q39). */
  invalidateResetTokens(userId: number, now: Date): Promise<void>;
  /** Deletes expired or used tokens; returns how many. */
  purgeResetTokens(now: Date): Promise<number>;
}

// --- service --------------------------------------------------------------------------------

export interface AuthServiceDeps {
  config: Config;
  db: Database;
  log: FastifyBaseLogger;
  sendPasswordResetEmail: SendPasswordResetEmail;
  userFiles: UserFileStore;
  /** Defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface RegisterInput {
  /** Already normalised by the `EmailInput` schema. */
  email: string;
  password: string;
  passwordConfirmation: string;
  gdprConsent: true;
}

export type ExportFormat = 'json' | 'csv';

export interface AccountExportFile {
  contentType: 'application/json' | 'application/zip';
  /** `recap-export-YYYY-MM-DD.json` or `.zip`. */
  filename: string;
  body: z.output<typeof AccountExport> | Buffer;
}

export type PublicUser = z.output<typeof User>;

/**
 * Business rules of accounts and access. Every method throws `AppError` with the codes named
 * in docs/design/auth.md; none of them touches `request` or `reply`.
 */
export interface AuthService {
  // UC-01
  /** → INVALID_REGISTRATION_DATA | PASSWORD_TOO_LONG | EMAIL_ALREADY_EXISTS */
  register(input: RegisterInput): Promise<IssuedSession>;

  // UC-02
  /** Design 3.2. → INVALID_CREDENTIALS | ACCOUNT_TEMPORARILY_LOCKED | ACCOUNT_BLOCKED */
  login(input: { email: string; password: string }): Promise<IssuedSession>;
  /** Design 2.3, steps 1–7. Never throws for an invalid cookie. */
  authenticate(cookieValue: string | undefined): Promise<AuthenticationResult>;

  // UC-03
  /** Design 4.1. Never reveals whether the address has an account; never throws for that. */
  requestPasswordReset(email: string): Promise<void>;
  /** Design 4.2. → RESET_TOKEN_INVALID | PASSWORD_TOO_LONG */
  confirmPasswordReset(input: { token: string; password: string }): Promise<void>;
  /** Design 4.3. Returns the number of deleted tokens. */
  purgeResetTokens(): Promise<number>;

  // UC-11
  getPreferences(actor: UserActor): Promise<PreferencesRecord>;
  updatePreferences(
    actor: UserActor,
    changes: z.output<typeof PreferencesUpdate>,
  ): Promise<PreferencesRecord>;

  // UC-12
  exportAccount(actor: UserActor, format: ExportFormat): Promise<AccountExportFile>;
  /** Design 5.1. → PASSWORD_CONFIRMATION_FAILED */
  deleteOwnAccount(actor: UserActor, password: string): Promise<void>;

  // for the admin module (UC-13, Segment 7); `actor` must be an administrator → FORBIDDEN
  listUsers(
    actor: UserActor,
    query: { status?: UserStatus; search?: string; page: number; pageSize: number },
  ): Promise<{ items: (PublicUser & { document_count: number })[]; total: number }>;
  /** Design 5.3. → NOT_FOUND | CONFLICT */
  setUserStatus(actor: UserActor, userId: number, status: UserStatus): Promise<PublicUser>;
  /** Design 5.3. → NOT_FOUND | CONFLICT */
  deleteUser(actor: UserActor, userId: number): Promise<void>;

  // for scripts/create-admin.ts (Q21)
  /** → INVALID_REGISTRATION_DATA | PASSWORD_TOO_LONG | EMAIL_ALREADY_EXISTS */
  createAdmin(input: { email: string; password: string }): Promise<PublicUser>;

  // for other modules
  getUserById(userId: number): Promise<PublicUser | null>;
}
