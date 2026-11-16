import { z } from 'zod';
import { MaterialTypeEnum } from '../../core/api-schemas.js';
import {
  LLM_CALL_STATUSES,
  LLM_OPERATIONS,
  REPORT_STATUSES,
  USER_ROLES,
  USER_STATUSES,
} from '../../core/domain.js';
import { DateOnly, Id, IdParam, PaginationQuery, Timestamp, paginated } from '../../core/http.js';

// --- accounts (RF21, UC-13) -----------------------------------------------------------------

/** No study content: the administrator never sees documents or results (SRS 3.4). */
export const AdminUser = z
  .object({
    id: Id,
    email: z.string(),
    role: z.enum(USER_ROLES),
    status: z.enum(USER_STATUSES),
    created_at: Timestamp,
    document_count: z.int().min(0),
  })
  .meta({ id: 'AdminUser' });

export const AdminUserList = paginated(AdminUser, 'AdminUserList');
export const AdminUserParams = z.object({ user_id: IdParam });
export const AdminUserListQuery = PaginationQuery.extend({
  status: z.enum(USER_STATUSES).optional(),
  search: z.string().trim().min(1).max(254).optional().describe('Part of the e-mail address'),
});

// --- usage statistics (RF22, UC-14) ---------------------------------------------------------

export const PeriodQuery = z.object({
  from: DateOnly.optional().describe('Inclusive; default: 30 days ago'),
  to: DateOnly.optional().describe('Inclusive; default: today'),
});

export const UsageStats = z
  .object({
    from: DateOnly,
    to: DateOnly,
    active_users_last_7_days: z.int().min(0),
    documents_uploaded: z.int().min(0),
    tests_started: z.int().min(0),
    tests_finished: z.int().min(0),
    test_completion_rate: z.number().min(0).max(1).nullable().describe('finished / started'),
  })
  .meta({ id: 'UsageStats' });

// --- model monitoring (RF23, UC-14) ---------------------------------------------------------

export const LlmCall = z
  .object({
    id: Id,
    created_at: Timestamp,
    operation: z.enum(LLM_OPERATIONS),
    status: z.enum(LLM_CALL_STATUSES),
    error_code: z.string().nullable(),
    attempt: z.int().min(1).max(3),
    duration_ms: z.int().min(0),
    input_tokens: z.int().min(0),
    output_tokens: z.int().min(0),
    estimated_cost: z.number().min(0).describe('USD'),
  })
  .meta({ id: 'LlmCall' });

export const LlmCallList = paginated(LlmCall, 'LlmCallList');
export const LlmCallListQuery = PaginationQuery.extend(PeriodQuery.shape).extend({
  operation: z.enum(LLM_OPERATIONS).optional(),
  status: z.enum(LLM_CALL_STATUSES).optional(),
});

export const LlmDailyStats = z
  .object({
    items: z.array(
      z.object({
        date: DateOnly,
        calls: z.int().min(0),
        failed_calls: z.int().min(0),
        input_tokens: z.int().min(0),
        output_tokens: z.int().min(0),
        estimated_cost: z.number().min(0),
        average_duration_ms: z.int().min(0),
      }),
    ),
  })
  .meta({ id: 'LlmDailyStats' });

export const LlmSummary = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .describe('Current month, YYYY-MM'),
    month_cost: z.number().min(0),
    monthly_cost_limit: z.number().min(0),
    cost_limit_exceeded: z.boolean().describe('True → show the alert (RF23)'),
    unverified_source_rate: z
      .number()
      .min(0)
      .max(1)
      .nullable()
      .describe('1 − accepted / received items in the period (RF9, RNF4)'),
  })
  .meta({ id: 'LlmSummary' });

// --- reported materials (RF24, UC-15) -------------------------------------------------------

/** The reason is shown; the text of the material is not (SRS 3.4 access rules). */
export const AdminReport = z
  .object({
    id: Id,
    material_id: Id,
    material_type: MaterialTypeEnum,
    material_status: z.enum(['valid', 'reported', 'removed']),
    reason: z.string(),
    status: z.enum(REPORT_STATUSES),
    created_at: Timestamp,
  })
  .meta({ id: 'AdminReport' });

export const AdminReportList = paginated(AdminReport, 'AdminReportList');
export const AdminReportParams = z.object({ report_id: IdParam });
export const AdminReportListQuery = PaginationQuery.extend({
  status: z.enum(REPORT_STATUSES).optional(),
});

// --- settings (RF25, UC-16) -----------------------------------------------------------------

const settingsShape = {
  max_file_size_mb: z.int().min(1).max(50),
  uploads_per_day: z.int().min(1).max(50),
  mastery_threshold_low: z.int().min(0).max(100),
  mastery_threshold_high: z.int().min(0).max(100),
  mastery_window: z.int().min(1).max(50).describe('n: answers used by the mastery formula'),
  mastery_decay: z.number().gt(0).max(1).describe('Weight factor of the mastery formula'),
  monthly_cost_limit: z.number().min(0).describe('USD per calendar month'),
};

export const Settings = z.object(settingsShape).meta({ id: 'Settings' });

export const SettingsUpdate = z.object(settingsShape).partial().meta({
  id: 'SettingsUpdate',
  description:
    'Only the fields present change. After the change the high threshold must stay above the low one.',
});
