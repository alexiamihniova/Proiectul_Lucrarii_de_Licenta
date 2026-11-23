import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { DOCUMENT_FORMATS, DOCUMENT_STATUSES } from '../../core/domain.js';
import { createdAt, id, oneOf, ref, timestamptz } from './_helpers.js';
import { users } from './accounts.js';

/** MATERIE */
export const subjects = pgTable(
  'subjects',
  {
    id: id(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar({ length: 100 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Q17: "Baze de date" and "baze de date" are the same name.
    uniqueIndex('subjects_user_id_name_key').on(t.userId, sql`lower(${t.name})`),
    check('subjects_name_check', sql`char_length(btrim(${t.name})) >= 1`),
  ],
);

/**
 * DOCUMENT. The row is also the unit of work of the analysis queue (ADR-0003): a worker
 * claims rows with status 'queued'. Status transitions are enforced by the trigger
 * `documents_enforce_status_transition` (see the first migration and DATA_MODEL.md).
 */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    subjectId: ref()
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
    fileName: varchar({ length: 255 }).notNull(),
    format: varchar({ length: 10 }).notNull(),
    sizeBytes: bigint({ mode: 'number' }).notNull(),
    /** Unknown until the text is extracted. */
    pageCount: integer(),
    status: varchar({ length: 20 }).notNull().default('queued'),
    /** Error code from core/errors.ts (e.g. TEXT_NOT_EXTRACTABLE); set iff status = 'error'. */
    errorReason: text(),
    uploadedAt: createdAt(),
    /** Not in the SRS: set on PP; lets the worker detect the 60 s timeout (PE) and stale claims. */
    processingStartedAt: timestamptz(),
    /** Soft delete (state „Șters”): set iff status = 'deleted'. */
    deletedAt: timestamptz(),
  },
  (t) => [
    index('documents_subject_id_uploaded_at_idx').on(t.subjectId, t.uploadedAt),
    index('documents_queue_idx')
      .on(t.uploadedAt)
      .where(sql`${t.status} = 'queued'`),
    check('documents_format_check', oneOf(t.format, DOCUMENT_FORMATS)),
    check('documents_status_check', oneOf(t.status, DOCUMENT_STATUSES)),
    check('documents_file_name_check', sql`char_length(btrim(${t.fileName})) >= 1`),
    check('documents_size_bytes_check', sql`${t.sizeBytes} > 0`),
    check('documents_page_count_check', sql`${t.pageCount} is null or ${t.pageCount} >= 1`),
    check(
      'documents_error_reason_check',
      sql`(${t.status} = 'error') = (${t.errorReason} is not null)`,
    ),
    check(
      'documents_deleted_at_check',
      sql`(${t.status} = 'deleted') = (${t.deletedAt} is not null)`,
    ),
    check(
      'documents_processing_started_at_check',
      sql`${t.status} <> 'processing' or ${t.processingStartedAt} is not null`,
    ),
  ],
);

/** PASAJ — 100–300 words, with page and character offsets into the cleaned document text. */
export const passages = pgTable(
  'passages',
  {
    id: id(),
    documentId: ref()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** „ordine”: 0-based position of the passage in the document. */
    position: integer().notNull(),
    page: integer().notNull(),
    startOffset: integer().notNull(),
    endOffset: integer().notNull(),
    text: text().notNull(),
  },
  (t) => [
    uniqueIndex('passages_document_id_position_key').on(t.documentId, t.position),
    check('passages_position_check', sql`${t.position} >= 0`),
    check('passages_page_check', sql`${t.page} >= 1`),
    check(
      'passages_offsets_check',
      sql`${t.startOffset} >= 0 and ${t.endOffset} > ${t.startOffset}`,
    ),
    check('passages_text_check', sql`char_length(${t.text}) >= 1`),
  ],
);

/**
 * PROPOZIȚIE (ADR-0013, Q46) — the smallest unit of the document text. Offsets index the
 * canonical text: the sentences of a paragraph joined by " ", the paragraphs by "\n\n". The
 * canonical text itself is not stored; it is rebuilt from the sentences (docs/design/documents.md,
 * section 3.2). A passage is a run of whole sentences.
 */
export const sentences = pgTable(
  'sentences',
  {
    id: id(),
    documentId: ref()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    passageId: ref()
      .notNull()
      .references(() => passages.id, { onDelete: 'cascade' }),
    /** 0-based order of the sentence in the document, without gaps. */
    position: integer().notNull(),
    /** 0-based number of the paragraph in the document. */
    paragraph: integer().notNull(),
    /** The page on which the sentence starts. */
    page: integer().notNull(),
    startOffset: integer().notNull(),
    endOffset: integer().notNull(),
    text: text().notNull(),
  },
  (t) => [
    uniqueIndex('sentences_document_id_position_key').on(t.documentId, t.position),
    index('sentences_passage_id_idx').on(t.passageId),
    check('sentences_position_check', sql`${t.position} >= 0`),
    check('sentences_paragraph_check', sql`${t.paragraph} >= 0`),
    check('sentences_page_check', sql`${t.page} >= 1`),
    check(
      'sentences_offsets_check',
      sql`${t.startOffset} >= 0 and ${t.endOffset} > ${t.startOffset}`,
    ),
    check('sentences_text_check', sql`char_length(${t.text}) >= 1`),
  ],
);
