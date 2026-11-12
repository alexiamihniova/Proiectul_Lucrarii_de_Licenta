import type { DocumentStatus } from '../../core/domain.js';
import { AppError } from '../../core/errors.js';

/**
 * State machine of a document — Dosar, Tabelul 3.1 (states × events), encoded as data.
 * The database enforces the same table with the trigger `documents_enforce_status_transition`;
 * tests/document-state-machine.test.ts checks all 30 cells against both.
 */

export const DOCUMENT_EVENTS = [
  'processing_started', // PP — a worker claims the document
  'processing_succeeded', // PR
  'processing_failed', // PE — failure or the 60 s limit
  'reprocess_requested', // RP
  'renamed', // RD
  'deleted', // ȘT — confirmed deletion
] as const;

export type DocumentEvent = (typeof DOCUMENT_EVENTS)[number];

/** `null` is an empty cell („—”): the event is impossible or ignored in that state. */
export const DOCUMENT_TRANSITIONS: Record<
  DocumentStatus,
  Record<DocumentEvent, DocumentStatus | null>
> = {
  queued: {
    processing_started: 'processing',
    processing_succeeded: null,
    processing_failed: null,
    reprocess_requested: null, // C-09: already in the queue
    renamed: 'queued',
    deleted: 'deleted',
  },
  processing: {
    processing_started: null,
    processing_succeeded: 'ready',
    processing_failed: 'error',
    reprocess_requested: null, // C-09
    renamed: 'processing',
    deleted: 'deleted', // C-08: the running analysis is cancelled, late results ignored
  },
  ready: {
    processing_started: null,
    processing_succeeded: null,
    processing_failed: null,
    reprocess_requested: 'queued',
    renamed: 'ready',
    deleted: 'deleted',
  },
  error: {
    processing_started: null,
    processing_succeeded: null, // C-10: a late result is rejected
    processing_failed: null,
    reprocess_requested: 'queued',
    renamed: 'error',
    deleted: 'deleted',
  },
  deleted: {
    processing_started: null,
    processing_succeeded: null, // C-08: a late result is ignored
    processing_failed: null,
    reprocess_requested: null,
    renamed: null,
    deleted: null,
  },
};

/** The next status, or `null` when the table has an empty cell. Never throws. */
export function nextDocumentStatus(
  status: DocumentStatus,
  event: DocumentEvent,
): DocumentStatus | null {
  return DOCUMENT_TRANSITIONS[status][event];
}

/**
 * Like `nextDocumentStatus`, for events requested by a user: an empty cell becomes the error
 * the API returns. Worker events (PP, PR, PE) on an empty cell must be dropped silently by the
 * caller instead (C-08, C-10) — use `nextDocumentStatus` for those.
 */
export function applyUserDocumentEvent(
  status: DocumentStatus,
  event: Extract<DocumentEvent, 'reprocess_requested' | 'renamed' | 'deleted'>,
): DocumentStatus {
  const next = nextDocumentStatus(status, event);
  if (next !== null) return next;
  if (status === 'deleted') throw new AppError('NOT_FOUND');
  if (event === 'reprocess_requested') throw new AppError('DOCUMENT_ALREADY_PROCESSING');
  throw new AppError('CONFLICT');
}
