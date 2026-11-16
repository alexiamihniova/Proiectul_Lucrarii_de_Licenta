import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import type { UserActor } from '../../core/actor.js';
import { AppError } from '../../core/errors.js';
import { NoContent, endpoint } from '../../core/http.js';
import { auditLog } from '../../core/logger.js';
import { clearedSessionCookie, sessionCookie } from './cookies.js';
import {
  AccountDeleteRequest,
  AccountExport,
  ExportQuery,
  LoginRequest,
  PasswordResetConfirm,
  PasswordResetRequest,
  Preferences,
  PreferencesUpdate,
  RegisterRequest,
  SessionResponse,
} from './schemas.js';

const tag = 'auth';

/** The hook sets the actor on every route that is not public; this only narrows the type. */
function requireActor(request: FastifyRequest): UserActor {
  if (!request.actor) throw new AppError('UNAUTHENTICATED');
  return request.actor;
}

/** Segment 1 — UC-01, UC-02, UC-03, UC-11, UC-12. */
export const authRouter: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: 'POST',
    url: '/auth/register',
    ...endpoint(
      {
        uc: ['UC-01'],
        operationId: 'register',
        summary: 'Create an account and open a session',
        description:
          'RF1. On success the session cookie is set and the account gets its default preferences. Any invalid field answers `INVALID_REGISTRATION_DATA` (M01) with `details` listing the fields; a password over 72 bytes answers `PASSWORD_TOO_LONG`; an address that already has an account answers `EMAIL_ALREADY_EXISTS` (M02). Rate limited per IP (`TOO_MANY_REQUESTS`).',
        tag,
        auth: 'public',
        errors: [403, 409, 429],
      },
      { body: RegisterRequest, response: { 201: SessionResponse } },
    ),
    attachValidation: true,
    handler: async (request, reply) => {
      // M01: any invalid field answers INVALID_REGISTRATION_DATA, with the fields in `details`.
      const invalid = request.validationError;
      if (invalid) {
        throw new AppError(
          'INVALID_REGISTRATION_DATA',
          (invalid.validation as { instancePath: string; message?: string }[]).map((issue) => ({
            path: `body${issue.instancePath}`,
            message: issue.message ?? 'invalid',
          })),
        );
      }
      const session = await app.auth.register({
        email: request.body.email,
        password: request.body.password,
        passwordConfirmation: request.body.password_confirmation,
        gdprConsent: request.body.gdpr_consent,
      });
      return reply
        .code(201)
        .header('set-cookie', sessionCookie(app.config, session.token))
        .send(session.response);
    },
  });

  app.route({
    method: 'POST',
    url: '/auth/login',
    ...endpoint(
      {
        uc: ['UC-02'],
        operationId: 'login',
        summary: 'Authenticate with e-mail and password',
        description:
          'RF2. Sets the session cookie (JWT, ≤ 24 h, HttpOnly, SameSite=Lax). Errors: `INVALID_CREDENTIALS` (M03, 401) for an unknown address or a wrong password, identically; `ACCOUNT_TEMPORARILY_LOCKED` (429) from the 5th consecutive failure and for 15 minutes, with `details.retry_after_seconds` and a `Retry-After` header (C-12, C-17); `ACCOUNT_BLOCKED` (403) only with the correct password; `TOO_MANY_REQUESTS` (429) for the per-IP limit.',
        tag,
        auth: 'public',
        errors: [401, 403, 429],
      },
      { body: LoginRequest, response: { 200: SessionResponse } },
    ),
    handler: async (request, reply) => {
      try {
        const session = await app.auth.login(request.body);
        return await reply
          .header('set-cookie', sessionCookie(app.config, session.token))
          .send(session.response);
      } catch (error) {
        if (error instanceof AppError && error.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
          const { retry_after_seconds: seconds } = error.details as {
            retry_after_seconds: number;
          };
          reply.header('retry-after', String(seconds)); // C-12
        }
        throw error;
      }
    },
  });

  app.route({
    method: 'POST',
    url: '/auth/logout',
    ...endpoint(
      {
        uc: ['UC-02'],
        operationId: 'logout',
        summary: 'Close the session (clears the cookie)',
        tag,
        auth: 'any',
      },
      { response: { 204: NoContent } },
    ),
    handler: async (request, reply) => {
      // The token is not revoked (accepted risk, ADR-0011): the browser forgets it.
      auditLog(request.log, { action: 'auth.logout', actor_id: request.user?.id ?? null });
      return reply.code(204).header('set-cookie', clearedSessionCookie(app.config)).send();
    },
  });

  app.route({
    method: 'GET',
    url: '/auth/me',
    ...endpoint(
      {
        uc: ['UC-02'],
        operationId: 'getCurrentSession',
        summary: 'Current user and session expiry',
        description:
          'The frontend calls it on load; `401 UNAUTHENTICATED` means "show D15 Sesiune expirată" (C-11).',
        tag,
        auth: 'any',
      },
      { response: { 200: SessionResponse } },
    ),
    handler: async (request) => {
      const user = request.user ? await app.auth.getUserById(request.user.id) : null;
      if (!user || !request.sessionExpiresAt) throw new AppError('UNAUTHENTICATED');
      // The session is not extended by activity (Q41): this is the `exp` of the token.
      return { user, expires_at: request.sessionExpiresAt.toISOString() };
    },
  });

  app.route({
    method: 'POST',
    url: '/auth/password-reset/request',
    ...endpoint(
      {
        uc: ['UC-03'],
        operationId: 'requestPasswordReset',
        summary: 'E-mail a password reset link',
        description:
          'RF2, C-24. Always answers 202, whether or not the address has an account, so that accounts cannot be enumerated. The link is valid for 1 hour and can be used once.',
        tag,
        auth: 'public',
        errors: [403, 429],
      },
      { body: PasswordResetRequest, response: { 202: z.undefined().describe('Accepted') } },
    ),
    handler: async (request, reply) => {
      await app.auth.requestPasswordReset(request.body.email);
      return reply.code(202).send();
    },
  });

  app.route({
    method: 'POST',
    url: '/auth/password-reset/confirm',
    ...endpoint(
      {
        uc: ['UC-03'],
        operationId: 'confirmPasswordReset',
        summary: 'Set a new password with a reset token',
        description:
          'On success every existing session of the account stops working and no new session is opened: the user logs in with the new password. Errors: `RESET_TOKEN_INVALID` (unknown, expired or already used token, identically), `PASSWORD_TOO_LONG`.',
        tag,
        auth: 'public',
        errors: [403, 429],
      },
      { body: PasswordResetConfirm, response: { 204: NoContent } },
    ),
    handler: async (request, reply) => {
      if (request.body.password !== request.body.password_confirmation) {
        throw new AppError('VALIDATION_ERROR', [
          { path: 'body/password_confirmation', message: 'must equal the password' },
        ]);
      }
      await app.auth.confirmPasswordReset({
        token: request.body.token,
        password: request.body.password,
      });
      return reply.code(204).send();
    },
  });

  app.route({
    method: 'GET',
    url: '/preferences',
    ...endpoint(
      {
        uc: ['UC-11'],
        operationId: 'getPreferences',
        summary: 'Read the preferences of the current user',
        tag,
        auth: 'any',
      },
      { response: { 200: Preferences } },
    ),
    handler: async (request) => app.auth.getPreferences(requireActor(request)),
  });

  app.route({
    method: 'PATCH',
    url: '/preferences',
    ...endpoint(
      {
        uc: ['UC-11'],
        operationId: 'updatePreferences',
        summary: 'Change some preferences',
        description: 'RF18. Only the fields present in the body change.',
        tag,
        auth: 'any',
      },
      { body: PreferencesUpdate, response: { 200: Preferences } },
    ),
    handler: async (request) => app.auth.updatePreferences(requireActor(request), request.body),
  });

  app.route({
    method: 'GET',
    url: '/account/export',
    ...endpoint(
      {
        uc: ['UC-12'],
        operationId: 'exportAccountData',
        summary: 'Export own data as JSON or CSV',
        description:
          'RF20. `format=json` returns one JSON document; `format=csv` returns a ZIP archive with one CSV file per data set.',
        tag,
        auth: 'student',
      },
      {
        querystring: ExportQuery,
        response: {
          200: {
            description: 'The export, as a download',
            content: {
              'application/json': { schema: AccountExport },
              'application/zip': { schema: z.string().meta({ format: 'binary' }) },
            },
          },
        },
      },
    ),
    handler: async (request, reply) => {
      const file = await app.auth.exportAccount(requireActor(request), request.query.format);
      return reply
        .header('content-type', file.contentType)
        .header('content-disposition', `attachment; filename="${file.filename}"`)
        .send(file.body as never);
    },
  });

  app.route({
    method: 'POST',
    url: '/account/delete',
    ...endpoint(
      {
        uc: ['UC-12'],
        operationId: 'deleteAccount',
        summary: 'Delete own account and all its data',
        description:
          'RF20. Requires the current password. Removes everything from the active database at once and clears the session. Errors: `PASSWORD_CONFIRMATION_FAILED`.',
        tag,
        auth: 'student',
      },
      { body: AccountDeleteRequest, response: { 204: NoContent } },
    ),
    handler: async (request, reply) => {
      await app.auth.deleteOwnAccount(requireActor(request), request.body.password);
      return reply.code(204).header('set-cookie', clearedSessionCookie(app.config)).send();
    },
  });
};
