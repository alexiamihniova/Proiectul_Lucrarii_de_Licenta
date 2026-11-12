import type { FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError, errorBody } from './errors.js';

/**
 * The single place where errors become HTTP responses. Modules only `throw new AppError(code)`;
 * nothing else in the code base calls `reply.code(4xx/5xx)` with an ad-hoc body.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(
        errorBody(
          'ROUTE_NOT_FOUND',
          undefined,
          `Ruta ${request.method} ${request.url.split('?')[0]} nu există.`,
        ),
      );
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      if (error.status >= 500 && error.code !== 'NOT_IMPLEMENTED') {
        request.log.error({ err: error }, 'request failed');
      }
      return reply.code(error.status).send(errorBody(error.code, error.details, error.message));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        path: `${error.validationContext ?? 'body'}${issue.instancePath}`,
        message: issue.message ?? 'invalid',
      }));
      return reply.code(400).send(errorBody('VALIDATION_ERROR', details));
    }

    if (isResponseSerializationError(error)) {
      // A handler returned something that violates its own response schema: a server bug.
      request.log.error({ err: error }, 'response does not match the declared schema');
      return reply.code(500).send(errorBody('INTERNAL_ERROR'));
    }

    const status = (error as { statusCode?: number }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      // Errors raised by Fastify itself or by plugins (malformed JSON, payload too large, …).
      const fastifyCode = (error as { code?: string }).code;
      if (status === 413) return reply.code(413).send(errorBody('FILE_TOO_LARGE'));
      if (status === 415) return reply.code(415).send(errorBody('UNSUPPORTED_FILE_FORMAT'));
      if (status === 404) return reply.code(404).send(errorBody('NOT_FOUND'));
      return reply
        .code(400)
        .send(
          errorBody(
            'VALIDATION_ERROR',
            fastifyCode ? [{ path: 'request', message: fastifyCode }] : undefined,
          ),
        );
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR'));
  });
}
