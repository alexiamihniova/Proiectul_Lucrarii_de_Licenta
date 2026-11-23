import type { Readable } from 'node:stream';
import type { FastifyBaseLogger } from 'fastify';
import type { z } from 'zod';
import type { UserActor } from '../../core/actor.js';
import type { Passage } from '../../core/api-schemas.js';
import type { Config } from '../../core/config.js';
import type { DocumentFormat } from '../../core/domain.js';
import type { Database } from '../../db/client.js';
import type { UserFileStore } from '../auth/service.js';
import type { Document, Subject, UploadQuota } from './schemas.js';

/**
 * Interfaces and types of the documents module. Specification: docs/design/documents.md.
 * Segment 2B implements them WITHOUT changing their shape; the tests in tests/documents/ rely
 * on it.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /** The documents service of this application instance. Decorated in src/app.ts (2B). */
    documents: DocumentsService;
  }
}

// --- text extraction (design 3.7) -----------------------------------------------------------

/** One page as read from the file: lines separated by `\n`, paragraphs by blank lines. */
export interface RawPage {
  /** 1-based. */
  number: number;
  text: string;
}

export interface ExtractedText {
  pages: RawPage[];
  /**
   * `true` when the pages are the real pages of the file (PDF). `false` for DOCX and TXT,
   * which arrive as one "page" and get their page numbers from the 3000-character rule (Q16).
   */
  paged: boolean;
}

/**
 * Reads the text of an uploaded file. A port: the default implementation handles PDF, DOCX
 * and TXT; tests may inject another one through `AppDependencies.textExtractor`.
 * Throws `AppError('TEXT_NOT_EXTRACTABLE')` for a corrupt, encrypted or unreadable file.
 */
export interface TextExtractor {
  extract(
    input: { format: DocumentFormat; content: Buffer },
    signal: AbortSignal,
  ): Promise<ExtractedText>;
}

// --- counting the pages of a PDF at upload (design 2.5; Q48) -------------------------------

/**
 * What came of counting the pages of a PDF without extracting its text.
 *  - `pages`: the count (the page tree only, never the content of the pages);
 *  - `unreadable`: the file is corrupt, encrypted or not a real PDF — the upload goes on and
 *    the analysis decides (M06);
 *  - `timeout`, `memory`: counting was stopped by the limits — the file is refused as too complex.
 */
export type PageCountOutcome =
  | { kind: 'pages'; pages: number }
  | { kind: 'unreadable' }
  | { kind: 'timeout' }
  | { kind: 'memory' };

/**
 * Counts the pages of a PDF at upload. A port: the default implementation reads the page tree in
 * a separate thread with the given limits; tests inject another one through
 * `AppDependencies.pdfPageCounter`. It must not throw for the outcomes above; an exception is
 * a defect, and the upload then goes on (design 2.5).
 */
export interface PdfPageCounter {
  count(
    content: Buffer,
    limits: { timeoutMs: number; maxMemoryMb: number },
  ): Promise<PageCountOutcome>;
}

// --- structured text (design 3; ADR-0013) ---------------------------------------------------

/** A sentence: the smallest unit of the document text. Offsets index the canonical text. */
export interface SentenceRecord {
  /** 0-based order in the document, without gaps. */
  position: number;
  /** 0-based number of the paragraph in the document. */
  paragraph: number;
  /** 1-based page on which the sentence starts. */
  page: number;
  startOffset: number;
  /** Exclusive. */
  endOffset: number;
  text: string;
  /** `position` of the passage that contains the sentence. */
  passagePosition: number;
}

/** A passage (PASAJ, RF4): a run of whole sentences, 100–300 words. */
export interface PassageRecord {
  position: number;
  /** Page of its first sentence. */
  page: number;
  startOffset: number;
  endOffset: number;
  text: string;
  /** `position` of its first and last sentence, inclusive. */
  firstSentence: number;
  lastSentence: number;
}

/** What `structureText` produces and what is stored for a document. */
export interface StructuredText {
  /** The canonical text: sentences joined by " " inside a paragraph, paragraphs by "\n\n". */
  text: string;
  pageCount: number;
  sentences: SentenceRecord[];
  passages: PassageRecord[];
}

/** Stored structure of one document, with the database ids of its passages. */
export interface DocumentStructure extends StructuredText {
  documentId: number;
  passages: (PassageRecord & { id: number })[];
  sentences: (SentenceRecord & { passageId: number })[];
}

export const PASSAGE_MIN_WORDS = 100;
export const PASSAGE_MAX_WORDS = 300;
/** RF4, M06: a shorter canonical text means the file had no readable text. */
export const MIN_TEXT_LENGTH = 200;
/** Q16: one "page" of a DOCX or TXT file, in characters of canonical text. */
export const CHARACTERS_PER_PAGE = 3000;

// --- analysis port (design 4.2) -------------------------------------------------------------

/**
 * Concept extraction for a document whose text is stored (RF7; Segment 3). documents never
 * imports the analysis module: src/app.ts and src/worker.ts pass the function in. It resolves
 * → the document becomes `ready`; it throws an `AppError` → `error` with that code.
 */
export type AnalyseDocument = (input: { documentId: number }, signal: AbortSignal) => Promise<void>;

// --- service --------------------------------------------------------------------------------

export interface DocumentsServiceDeps {
  config: Config;
  db: Database;
  log: FastifyBaseLogger;
  /** Defaults to an analysis that does nothing, until Segment 3 (Q52). */
  analyseDocument?: AnalyseDocument;
  /** Defaults to the extractor for PDF, DOCX and TXT. */
  textExtractor?: TextExtractor;
  /** Defaults to the page counter that reads the PDF page tree in a thread. */
  pdfPageCounter?: PdfPageCounter;
  /** Defaults to `() => new Date()`. */
  now?: () => Date;
}

export type SubjectView = z.output<typeof Subject>;
export type DocumentView = z.output<typeof Document>;
export type PassageView = z.output<typeof Passage>;
export type UploadQuotaView = z.output<typeof UploadQuota>;

export interface Page<T> {
  items: T[];
  total: number;
}

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface UploadedFile {
  /** As sent by the client; never used as a path (design 2.3, 8). */
  fileName: string;
  content: Buffer;
  /** `true` when the transport cut the file at UPLOAD_HARD_LIMIT_MB → FILE_TOO_LARGE. */
  truncated?: boolean;
}

export interface DocumentFile {
  contentType: string;
  /** The document's current name, for Content-Disposition. */
  fileName: string;
  sizeBytes: number;
  stream: Readable;
}

/**
 * Business rules of subjects and documents. Every method that takes a `UserActor` acts on
 * that student's data only and throws `AppError('NOT_FOUND')` for anything else, including
 * deleted documents. None of them touches `request` or `reply`.
 */
export interface DocumentsService {
  // subjects (design 1)
  listSubjects(actor: UserActor, query: PageQuery): Promise<Page<SubjectView>>;
  /** → SUBJECT_NAME_TAKEN */
  createSubject(actor: UserActor, input: { name: string }): Promise<SubjectView>;
  getSubject(actor: UserActor, subjectId: number): Promise<SubjectView>;
  /** → SUBJECT_NAME_TAKEN */
  renameSubject(actor: UserActor, subjectId: number, input: { name: string }): Promise<SubjectView>;
  deleteSubject(actor: UserActor, subjectId: number): Promise<void>;

  // upload (design 2)
  /** → VALIDATION_ERROR | UNSUPPORTED_FILE_FORMAT | FILE_TOO_LARGE | DAILY_UPLOAD_LIMIT_REACHED */
  uploadDocument(actor: UserActor, subjectId: number, file: UploadedFile): Promise<DocumentView>;
  getUploadQuota(actor: UserActor): Promise<UploadQuotaView>;

  // documents (design 5, 6)
  listDocuments(
    actor: UserActor,
    query: PageQuery & { subjectId?: number; status?: DocumentView['status'] },
  ): Promise<Page<DocumentView>>;
  getDocument(actor: UserActor, documentId: number): Promise<DocumentView>;
  renameDocument(
    actor: UserActor,
    documentId: number,
    input: { fileName: string },
  ): Promise<DocumentView>;
  deleteDocument(actor: UserActor, documentId: number): Promise<void>;
  /** → DOCUMENT_ALREADY_PROCESSING (C-09) */
  reprocessDocument(actor: UserActor, documentId: number): Promise<DocumentView>;
  openDocumentFile(actor: UserActor, documentId: number): Promise<DocumentFile>;
  /** → DOCUMENT_NOT_READY */
  listPassages(
    actor: UserActor,
    documentId: number,
    query: PageQuery & { pageNumber?: number },
  ): Promise<Page<PassageView>>;

  // for the analysis and content modules (design 7)
  /** Same as `getDocument`; the name other modules use to check ownership. */
  getOwnedDocument(actor: UserActor, documentId: number): Promise<DocumentView>;
  /** The passages with these ids, in document order. → NOT_FOUND if any is not in the document. */
  getPassagesByIds(
    actor: UserActor,
    documentId: number,
    passageIds: number[],
  ): Promise<PassageView[]>;
  /** → DOCUMENT_NOT_READY while the text is not stored. */
  getDocumentStructure(actor: UserActor, documentId: number): Promise<DocumentStructure>;
  /**
   * For the analysis port, which runs in the worker without a user. Returns `null` when the
   * document does not exist, is deleted or has no stored text. Never use it to serve a request.
   */
  getStructureForAnalysis(documentId: number): Promise<DocumentStructure | null>;

  // background work (design 4, 9)
  /** Claims the oldest queued document and processes it. `false` when the queue is empty. */
  processNextDocument(signal?: AbortSignal): Promise<boolean>;
  /** Design 4.3. Returns how many documents were moved to `error`. */
  failStuckDocuments(): Promise<number>;
  /** Design 5 (Q12). Returns how many soft-deleted rows were removed. */
  purgeDeletedDocuments(): Promise<number>;
  /** Design 8. Returns how many files were removed. */
  removeOrphanFiles(): Promise<number>;

  // for the auth module (design 8; Q43)
  userFiles: UserFileStore;
}
