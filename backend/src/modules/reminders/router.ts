import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { NoContent, endpoint, notImplemented } from '../../core/http.js';
import { InAppReminder, UnsubscribeRequest } from './schemas.js';

const tag = 'reminders';

/**
 * Segment 8 — RF19 is an internal, time-triggered function (no use case of its own); these
 * two routes are its visible side and belong to UC-11 „Modifică setările” (C-18).
 */
export const remindersRouter: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: 'GET',
    url: '/reminders/in-app',
    ...endpoint(
      {
        uc: ['UC-11'],
        operationId: 'getInAppReminder',
        summary: 'Whether to show today’s in-app reminder',
        description: 'RF19, EV8, for the `in_app` and `both` channels.',
        tag,
        auth: 'student',
      },
      { response: { 200: InAppReminder } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/reminders/unsubscribe',
    ...endpoint(
      {
        uc: ['UC-11'],
        operationId: 'unsubscribeFromReminders',
        summary: 'Stop e-mail reminders using the link from an e-mail',
        description:
          'C-18. No session needed: the token identifies the account. Takes effect at once and shows in the settings. Errors: `UNSUBSCRIBE_TOKEN_INVALID`.',
        tag,
        auth: 'public',
      },
      { body: UnsubscribeRequest, response: { 204: NoContent } },
    ),
    handler: notImplemented,
  });
};
