/**
 * Public surface of the documents module (Segment 2). Other modules import ONLY from this file.
 *
 * Segment 2 implements here: subjects CRUD; upload validation (format, size, pages, daily
 * quota — M04, M05, M08, C-07); file storage under UPLOAD_DIR; text extraction, cleaning and
 * splitting into passages (RF4; reference code in legacy/express); the document lifecycle
 * through `state-machine.ts`; soft delete (status `deleted`, children and file removed);
 * the worker task that claims `queued` documents (ADR-0003).
 *
 * Expected exports for other modules: `getOwnedDocument`, `listPassages`, `getPassagesByIds`
 * (analysis, content), `markDocumentReady` / `markDocumentFailed` (analysis),
 * `documentsWorkerTasks` (src/worker.ts).
 */
export {
  DOCUMENT_EVENTS,
  DOCUMENT_TRANSITIONS,
  applyUserDocumentEvent,
  nextDocumentStatus,
} from './state-machine.js';
export type { DocumentEvent } from './state-machine.js';
