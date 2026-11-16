import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  varchar,
} from 'drizzle-orm/pg-core';
import { LLM_CALL_STATUSES, LLM_OPERATIONS } from '../../core/domain.js';
import { createdAt, id, oneOf, ref, timestamptz } from './_helpers.js';
import { users } from './accounts.js';
import { documents } from './documents.js';

/**
 * APEL_LLM — one row per attempt of a call to the model (RF23, C-06). Never stores document
 * text. Survives the deletion of its user and document (C-20): both links become NULL.
 */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: id(),
    userId: ref().references(() => users.id, { onDelete: 'set null' }),
    documentId: ref().references(() => documents.id, { onDelete: 'set null' }),
    operation: varchar({ length: 30 }).notNull(),
    status: varchar({ length: 20 }).notNull(),
    /** C-06: provider/transport error code; set iff status <> 'success'. */
    errorCode: varchar({ length: 50 }),
    /** C-06: 1 = first try, 2–3 = retries. */
    attempt: smallint().notNull().default(1),
    durationMs: integer().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    estimatedCost: numeric({ precision: 12, scale: 6, mode: 'number' }).notNull().default(0),
    /** RF9/RF23 verified-source rate = sum(items_accepted) / sum(items_received). */
    itemsReceived: integer(),
    itemsAccepted: integer(),
    createdAt: createdAt(),
  },
  (t) => [
    index('llm_calls_created_at_idx').on(t.createdAt),
    index('llm_calls_user_id_idx').on(t.userId),
    index('llm_calls_document_id_idx').on(t.documentId),
    check('llm_calls_operation_check', oneOf(t.operation, LLM_OPERATIONS)),
    check('llm_calls_status_check', oneOf(t.status, LLM_CALL_STATUSES)),
    check('llm_calls_error_code_check', sql`(${t.status} = 'success') = (${t.errorCode} is null)`),
    check('llm_calls_attempt_check', sql`${t.attempt} between 1 and 3`),
    check(
      'llm_calls_counters_check',
      sql`${t.durationMs} >= 0 and ${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.estimatedCost} >= 0`,
    ),
    check(
      'llm_calls_items_check',
      sql`(${t.itemsReceived} is null and ${t.itemsAccepted} is null)
          or (${t.itemsAccepted} >= 0 and ${t.itemsReceived} >= ${t.itemsAccepted})`,
    ),
  ],
);

/** CONFIGURARE — key/value runtime settings (RF25). Keys: core/domain.ts → SETTING_KEYS. */
export const settings = pgTable('settings', {
  key: varchar({ length: 100 }).primaryKey(),
  value: jsonb().$type<number>().notNull(),
  updatedAt: timestamptz().notNull().defaultNow(),
});
