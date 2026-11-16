import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const HealthResponse = z
  .object({
    status: z.enum(['ok', 'error']),
    database: z.enum(['connected', 'unreachable']),
    uptime_seconds: z.int().min(0),
  })
  .meta({ id: 'HealthResponse' });

/**
 * Liveness + database readiness. Mounted twice: `/health` (containers, CI, load balancers)
 * and `/api/v1/health` (reachable through the frontend's `/api` proxy).
 */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: 'GET',
    url: '/health',
    config: { auth: 'public' },
    schema: {
      operationId: app.prefix ? 'getApiHealth' : 'getHealth',
      tags: ['system'],
      summary: 'Service and database health',
      security: [],
      response: { 200: HealthResponse, 503: HealthResponse },
    },
    handler: async (request, reply) => {
      const uptime_seconds = Math.floor(process.uptime());
      try {
        await app.db.pool.query('SELECT 1');
        return { status: 'ok' as const, database: 'connected' as const, uptime_seconds };
      } catch (error) {
        request.log.error({ err: error }, 'health check: database unreachable');
        return reply
          .code(503)
          .send({ status: 'error' as const, database: 'unreachable' as const, uptime_seconds });
      }
    },
  });
};
