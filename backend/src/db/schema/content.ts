import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  CONCEPT_ORIGINS,
  MATERIAL_STATUSES,
  MATERIAL_TYPES,
  REPORT_STATUSES,
} from '../../core/domain.js';
import { createdAt, id, oneOf, ref, timestamptz } from './_helpers.js';
import { users } from './accounts.js';
import { passages, subjects } from './documents.js';

/** CONCEPT — belongs to a subject; its document is derived through concept_passages. */
export const concepts = pgTable(
  'concepts',
  {
    id: id(),
    subjectId: ref()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    name: varchar({ length: 80 }).notNull(),
    definition: varchar({ length: 300 }).notNull().default(''),
    origin: varchar({ length: 20 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('concepts_subject_id_idx').on(t.subjectId),
    check('concepts_name_check', sql`char_length(btrim(${t.name})) >= 1`),
    check('concepts_origin_check', oneOf(t.origin, CONCEPT_ORIGINS)),
  ],
);

/** CONCEPT_PASAJ — N:M between concepts and their source passages. */
export const conceptPassages = pgTable(
  'concept_passages',
  {
    conceptId: ref()
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    passageId: ref()
      .notNull()
      .references(() => passages.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.conceptId, t.passageId] }),
    index('concept_passages_passage_id_idx').on(t.passageId),
  ],
);

/** MATERIAL */
export const materials = pgTable(
  'materials',
  {
    id: id(),
    conceptId: ref()
      .notNull()
      .references(() => concepts.id, { onDelete: 'cascade' }),
    passageId: ref()
      .notNull()
      .references(() => passages.id, { onDelete: 'cascade' }),
    type: varchar({ length: 20 }).notNull(),
    /** „enunț”: the summary text, the flashcard front, or the question. */
    statement: text().notNull(),
    /** Null only for summaries. For true_false: 'true' | 'false'. */
    correctAnswer: text(),
    /** „variante”: JSON array of exactly 4 strings, multiple_choice only. */
    options: jsonb().$type<string[]>(),
    explanation: text(),
    /** „citat”: verbatim excerpt of the source passage. */
    quote: text(),
    sourceVerified: boolean().notNull().default(false),
    status: varchar({ length: 20 }).notNull().default('valid'),
    createdAt: createdAt(),
  },
  (t) => [
    index('materials_concept_id_type_idx').on(t.conceptId, t.type),
    index('materials_passage_id_idx').on(t.passageId),
    check('materials_type_check', oneOf(t.type, MATERIAL_TYPES)),
    check('materials_status_check', oneOf(t.status, MATERIAL_STATUSES)),
    check('materials_statement_check', sql`char_length(btrim(${t.statement})) >= 1`),
    check(
      'materials_options_check',
      sql`case when ${t.type} = 'multiple_choice'
            then ${t.options} is not null
                 and jsonb_typeof(${t.options}) = 'array'
                 and jsonb_array_length(${t.options}) = 4
            else ${t.options} is null end`,
    ),
    check(
      'materials_correct_answer_check',
      sql`${t.type} = 'summary' or ${t.correctAnswer} is not null`,
    ),
    check(
      'materials_valid_requires_verified_source_check',
      sql`${t.status} <> 'valid' or ${t.sourceVerified}`,
    ),
  ],
);

/** TEST */
export const tests = pgTable(
  'tests',
  {
    id: id(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Not in the SRS entity list: needed so that deleting a subject deletes its tests (RF3). */
    subjectId: ref()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    /** „configurare”: the RF11 options as submitted (see content/schemas.ts → TestConfig). */
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    startedAt: createdAt(),
    finishedAt: timestamptz(),
    totalScore: numeric({ precision: 5, scale: 2, mode: 'number' }),
  },
  (t) => [
    index('tests_user_id_started_at_idx').on(t.userId, t.startedAt),
    index('tests_subject_id_idx').on(t.subjectId),
    check(
      'tests_total_score_check',
      sql`${t.totalScore} is null or ${t.totalScore} between 0 and 100`,
    ),
    check(
      'tests_finished_at_check',
      sql`${t.finishedAt} is null or ${t.finishedAt} >= ${t.startedAt}`,
    ),
    check(
      'tests_score_requires_finish_check',
      sql`${t.totalScore} is null or ${t.finishedAt} is not null`,
    ),
  ],
);

/** RĂSPUNS — an answer given in a test (test_id set) or in a review session (test_id null). */
export const answers = pgTable(
  'answers',
  {
    id: id(),
    testId: ref().references(() => tests.id, { onDelete: 'cascade' }),
    materialId: ref()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    givenAnswer: text().notNull(),
    /** „scor c”: 0, 0.5 or 1. NULL = „neevaluat” (C-04): the model was unavailable. */
    score: numeric({ precision: 2, scale: 1, mode: 'number' }),
    /** „calitate q” for SM-2 (1–5). NULL while the answer is not evaluated. */
    quality: smallint(),
    answeredAt: createdAt(),
  },
  (t) => [
    index('answers_material_id_answered_at_idx').on(t.materialId, t.answeredAt),
    uniqueIndex('answers_test_id_material_id_key')
      .on(t.testId, t.materialId)
      .where(sql`${t.testId} is not null`),
    check('answers_score_check', sql`${t.score} is null or ${t.score} in (0, 0.5, 1)`),
    check('answers_quality_check', sql`${t.quality} is null or ${t.quality} between 1 and 5`),
  ],
);

/** RAPORT_MATERIAL (C-19) */
export const materialReports = pgTable(
  'material_reports',
  {
    id: id(),
    materialId: ref()
      .notNull()
      .references(() => materials.id, { onDelete: 'cascade' }),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar({ length: 300 }).notNull(),
    status: varchar({ length: 20 }).notNull().default('new'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('material_reports_material_id_user_id_key').on(t.materialId, t.userId),
    index('material_reports_status_created_at_idx').on(t.status, t.createdAt),
    index('material_reports_user_id_idx').on(t.userId),
    check('material_reports_reason_check', sql`char_length(btrim(${t.reason})) >= 1`),
    check('material_reports_status_check', oneOf(t.status, REPORT_STATUSES)),
  ],
);
