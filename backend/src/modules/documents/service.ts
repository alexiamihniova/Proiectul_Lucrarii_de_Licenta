import { AppError } from '../../core/errors.js';
import type { WorkerTask } from '../../core/worker.js';
import type {
  DocumentsService,
  DocumentsServiceDeps,
  PdfPageCounter,
  ExtractedText,
  StructuredText,
  TextExtractor,
} from './types.js';

/**
 * Public surface of the documents module (Segment 2). Other modules import ONLY from this file.
 *
 * Specification: docs/design/documents.md. Contract: the tests in backend/tests/documents/.
 * Segment 2A defined the interfaces (./types.ts) and the entry points below; Segment 2B
 * replaces their bodies. The signatures are part of the contract and must not change.
 *
 * What the other modules use:
 *  - `DocumentsService.getOwnedDocument`, `listPassages`, `getPassagesByIds`,
 *    `getDocumentStructure`, `getStructureForAnalysis` (analysis, content);
 *  - `DocumentsService.userFiles` (auth: files of a deleted account, Q43);
 *  - `documentsWorkerTasks` (src/worker.ts).
 *
 * documents imports no module that is built after it: concept extraction arrives as the
 * `analyseDocument` function in `DocumentsServiceDeps`, wired in src/app.ts.
 */
export type * from './types.js';
export {
  CHARACTERS_PER_PAGE,
  MIN_TEXT_LENGTH,
  PASSAGE_MAX_WORDS,
  PASSAGE_MIN_WORDS,
} from './types.js';
export {
  DOCUMENT_EVENTS,
  DOCUMENT_TRANSITIONS,
  applyUserDocumentEvent,
  nextDocumentStatus,
} from './state-machine.js';
export type { DocumentEvent } from './state-machine.js';

/** Builds the service. Segment 2B: implement with ./repository.ts. */
export function createDocumentsService(_deps: DocumentsServiceDeps): DocumentsService {
  throw new AppError('NOT_IMPLEMENTED');
}

/**
 * PURE: cleans the extracted pages and splits them into paragraphs, sentences and passages
 * (design 3.3–3.6). Same input, same output. Throws `AppError('TEXT_NOT_EXTRACTABLE')` when
 * the canonical text has fewer than 200 characters and `AppError('FILE_TOO_LARGE')` (with
 * `details.exceeded = 'pages'`) when it has more than `maxPages` pages.
 */
export function structureText(
  _extracted: ExtractedText,
  _options: { maxPages: number },
): StructuredText {
  throw new AppError('NOT_IMPLEMENTED');
}

/** The page counter for PDF files at upload: a thread with a timeout and a memory limit (2.5). */
export function createPdfPageCounter(): PdfPageCounter {
  throw new AppError('NOT_IMPLEMENTED');
}

/** The extractor for PDF, DOCX and TXT (design 3.7). */
export function createTextExtractor(): TextExtractor {
  throw new AppError('NOT_IMPLEMENTED');
}

/** Background tasks of the module (design 9). */
export function documentsWorkerTasks(_service: DocumentsService): WorkerTask[] {
  throw new AppError('NOT_IMPLEMENTED');
}
