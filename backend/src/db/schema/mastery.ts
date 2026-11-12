import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  varchar,
} from 'drizzle-orm/pg-core';
import { MASTERY_STATUSES } from '../../core/domain.js';
import { oneOf, ref, timestamptz } from './_helpers.js';
import { users } from './accounts.js';
import { concepts } from './content.js';

/** PROGRES_CONCEPT — the mastery half of the dossier's STĂPÂNIRE entity. */
export const conceptProgress = pgTable(
  'concept_progress',
  {
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conceptId: ref()
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    /** „stăpânire S”: integer 0–100 (RB2). */
    mastery: smallint().notNull().default(0),
    status: varchar({ length: 20 }).notNull().default('new'),
    /** Not in the SRS: confetti already shown for the current stay above the threshold (RF17). */
    celebrated: boolean().notNull().default(false),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.conceptId] }),
    index('concept_progress_concept_id_idx').on(t.conceptId),
    check('concept_progress_mastery_check', sql`${t.mastery} between 0 and 100`),
    check('concept_progress_status_check', oneOf(t.status, MASTERY_STATUSES)),
  ],
);

/** RECAPITULARE — the SM-2 half of the dossier's STĂPÂNIRE entity (RB3). */
export const reviews = pgTable(
  'reviews',
  {
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    conceptId: ref()
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    easeFactor: numeric({ precision: 4, scale: 2, mode: 'number' }).notNull().default(2.5),
    /** „n”: consecutive successful repetitions. */
    repetitions: integer().notNull().default(0),
    intervalDays: integer().notNull().default(0),
    dueDate: date({ mode: 'string' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.conceptId] }),
    index('reviews_user_id_due_date_idx').on(t.userId, t.dueDate),
    index('reviews_concept_id_idx').on(t.conceptId),
    check('reviews_ease_factor_check', sql`${t.easeFactor} >= 1.3`),
    check('reviews_repetitions_check', sql`${t.repetitions} >= 0`),
    check('reviews_interval_days_check', sql`${t.intervalDays} >= 0`),
  ],
);
