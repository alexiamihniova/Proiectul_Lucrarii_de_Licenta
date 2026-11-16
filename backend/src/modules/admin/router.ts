import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { NoContent, endpoint, notImplemented } from '../../core/http.js';
import {
  AdminReport,
  AdminReportList,
  AdminReportListQuery,
  AdminReportParams,
  AdminUser,
  AdminUserList,
  AdminUserListQuery,
  AdminUserParams,
  LlmCallList,
  LlmCallListQuery,
  LlmDailyStats,
  LlmSummary,
  PeriodQuery,
  Settings,
  SettingsUpdate,
  UsageStats,
} from './schemas.js';

const tag = 'admin';

/** Segment 7 — UC-13, UC-14, UC-15, UC-16 (RF21–RF25). Every route requires role `admin`. */
export const adminRouter: FastifyPluginAsyncZod = async (app) => {
  // --- UC-13 accounts ---------------------------------------------------------------------

  app.route({
    method: 'GET',
    url: '/admin/users',
    ...endpoint(
      {
        uc: ['UC-13'],
        operationId: 'adminListUsers',
        summary: 'List accounts',
        tag,
        auth: 'admin',
      },
      { querystring: AdminUserListQuery, response: { 200: AdminUserList } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/admin/users/:user_id/block',
    ...endpoint(
      {
        uc: ['UC-13'],
        operationId: 'adminBlockUser',
        summary: 'Block an account',
        description: 'RF21. Written to the audit log.',
        tag,
        auth: 'admin',
        errors: [404, 409],
      },
      { params: AdminUserParams, response: { 200: AdminUser } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/admin/users/:user_id/unblock',
    ...endpoint(
      {
        uc: ['UC-13'],
        operationId: 'adminUnblockUser',
        summary: 'Unblock an account',
        tag,
        auth: 'admin',
        errors: [404, 409],
      },
      { params: AdminUserParams, response: { 200: AdminUser } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'DELETE',
    url: '/admin/users/:user_id',
    ...endpoint(
      {
        uc: ['UC-13'],
        operationId: 'adminDeleteUser',
        summary: 'Delete an account and all its data',
        description:
          'RF21. Same effect as the student deleting their own account. Written to the audit log; the model call journal keeps its rows without the user link (C-20).',
        tag,
        auth: 'admin',
        errors: [404, 409],
      },
      { params: AdminUserParams, response: { 204: NoContent } },
    ),
    handler: notImplemented,
  });

  // --- UC-14 usage and model monitoring ---------------------------------------------------

  app.route({
    method: 'GET',
    url: '/admin/stats/usage',
    ...endpoint(
      {
        uc: ['UC-14'],
        operationId: 'adminGetUsageStats',
        summary: 'Aggregated usage indicators for a period',
        description: 'RF22.',
        tag,
        auth: 'admin',
      },
      { querystring: PeriodQuery, response: { 200: UsageStats } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/admin/llm/calls',
    ...endpoint(
      {
        uc: ['UC-14'],
        operationId: 'adminListLlmCalls',
        summary: 'Journal of calls to the language model',
        description: 'RF23, C-06. Never contains document text.',
        tag,
        auth: 'admin',
      },
      { querystring: LlmCallListQuery, response: { 200: LlmCallList } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/admin/llm/daily',
    ...endpoint(
      {
        uc: ['UC-14'],
        operationId: 'adminGetLlmDailyStats',
        summary: 'Daily aggregates of model calls',
        description: 'RF23.',
        tag,
        auth: 'admin',
      },
      { querystring: PeriodQuery, response: { 200: LlmDailyStats } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'GET',
    url: '/admin/llm/summary',
    ...endpoint(
      {
        uc: ['UC-14', 'UC-17'],
        operationId: 'adminGetLlmSummary',
        summary: 'Month cost against the limit, and the unverified-source rate',
        description: 'RF23, RF9, RNF4.',
        tag,
        auth: 'admin',
      },
      { querystring: PeriodQuery, response: { 200: LlmSummary } },
    ),
    handler: notImplemented,
  });

  // --- UC-15 reported materials -----------------------------------------------------------

  app.route({
    method: 'GET',
    url: '/admin/reports',
    ...endpoint(
      {
        uc: ['UC-15'],
        operationId: 'adminListReports',
        summary: 'List reported materials',
        description: 'RF24.',
        tag,
        auth: 'admin',
      },
      { querystring: AdminReportListQuery, response: { 200: AdminReportList } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/admin/reports/:report_id/resolve',
    ...endpoint(
      {
        uc: ['UC-15'],
        operationId: 'adminResolveReport',
        summary: 'Mark a report as resolved; the material becomes valid again',
        tag,
        auth: 'admin',
        errors: [404, 409],
      },
      { params: AdminReportParams, response: { 200: AdminReport } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'POST',
    url: '/admin/reports/:report_id/remove-material',
    ...endpoint(
      {
        uc: ['UC-15'],
        operationId: 'adminRemoveReportedMaterial',
        summary: 'Remove the reported material and resolve its reports',
        description: 'RF24. The material gets status `removed` and is no longer used anywhere.',
        tag,
        auth: 'admin',
        errors: [404, 409],
      },
      { params: AdminReportParams, response: { 200: AdminReport } },
    ),
    handler: notImplemented,
  });

  // --- UC-16 settings ---------------------------------------------------------------------

  app.route({
    method: 'GET',
    url: '/admin/settings',
    ...endpoint(
      {
        uc: ['UC-16'],
        operationId: 'adminGetSettings',
        summary: 'Read the system settings',
        tag,
        auth: 'admin',
      },
      { response: { 200: Settings } },
    ),
    handler: notImplemented,
  });

  app.route({
    method: 'PATCH',
    url: '/admin/settings',
    ...endpoint(
      {
        uc: ['UC-16'],
        operationId: 'adminUpdateSettings',
        summary: 'Change limits and thresholds',
        description:
          'RF25, EV14. Values apply from the next operation. Written to the audit log with the author.',
        tag,
        auth: 'admin',
      },
      { body: SettingsUpdate, response: { 200: Settings } },
    ),
    handler: notImplemented,
  });
};
