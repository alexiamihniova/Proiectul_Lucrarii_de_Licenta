import type { UserActor } from '../../core/actor.js';
import type { DocumentFormat, DocumentStatus } from '../../core/domain.js';
import { AppError, ERRORS } from '../../core/errors.js';
import type { ErrorCode } from '../../core/errors.js';
import type { WorkerTask } from '../../core/worker.js';
import { getSettings } from '../admin/service.js';
import { countSubjectConcepts } from '../shared-queries/service.js';
import { createFileStore } from './files.js';
import { createTextExtractor } from './extractor.js';
import { createPdfPageCounter } from './pdf-pages.js';
import { createDocumentsRepository } from './repository.js';
import type { DocumentRow, PassageRecordRow, SubjectRecord } from './repository.js';
import { applyUserDocumentEvent, nextDocumentStatus } from './state-machine.js';
import type { DocumentEvent } from './state-machine.js';
import { structureText } from './structure.js';
import {
  ALLOWED_FORMATS,
  CONTENT_TYPES,
  cleanFileName,
  contentMatchesFormat,
  formatOfName,
  storedFileName,
} from './upload.js';
import type {
  DocumentFile,
  DocumentView,
  DocumentsService,
  DocumentsServiceDeps,
  PageCountOutcome,
  PassageView,
  SubjectView,
  UploadedFile,
  UploadQuotaView,
} from './types.js';

/**
 * Public surface of the documents module (Segment 2). Other modules import ONLY from this file.
 *
 * Specification: docs/design/documents.md. Contract: the tests in backend/tests/documents/.
 *
 * What the other modules use:
 *  - `DocumentsService.getOwnedDocument`, `listPassages`, `getPassagesByIds`,
 *    `getDocumentStructure`, `getStructureForAnalysis` (analysis, content);
 *  - `DocumentsService.userFiles` (auth: files of a deleted account, Q43);
 *  - `documentsWorkerTasks` (src/worker.ts; registered there by Segment 2C).
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
export { structureText } from './structure.js';
export { createPdfPageCounter } from './pdf-pages.js';
export { createTextExtractor } from './extractor.js';

const HOUR_MS = 3_600_000;
/** A file younger than this may belong to an upload that has not committed yet. */
const ORPHAN_MIN_AGE_MS = HOUR_MS;

const COMPLEXITY_MESSAGE =
  'Fișierul este prea complex pentru a fi verificat. Încarcă o variantă mai simplă sau mai mică.';

/** A user event on a document: the next status is decided by the state machine, not here. */
type UserEvent = Extract<DocumentEvent, 'reprocess_requested' | 'renamed' | 'deleted'>;

export function createDocumentsService(deps: DocumentsServiceDeps): DocumentsService {
  const { config, db, log } = deps;
  const repository = createDocumentsRepository(db);
  const files = createFileStore(config.upload.dir);
  const extractor =
    deps.textExtractor ??
    createTextExtractor({
      pdfMemoryMb: config.documents.extractMemoryMb,
      maxPages: config.upload.maxPages,
    });
  const pageCounter = deps.pdfPageCounter ?? createPdfPageCounter();
  const analyse = deps.analyseDocument ?? (async () => undefined);
  const now = deps.now ?? (() => new Date());

  // --- views -------------------------------------------------------------------------------

  function toDocumentView(row: DocumentRow): DocumentView {
    const code = row.errorReason as ErrorCode | null;
    return {
      id: row.id,
      subject_id: row.subjectId,
      file_name: row.fileName,
      format: row.format as DocumentFormat,
      size_bytes: row.sizeBytes,
      page_count: row.pageCount,
      status: row.status as DocumentView['status'],
      error: code ? { code, message: (ERRORS[code] ?? ERRORS.INTERNAL_ERROR).message } : null,
      uploaded_at: row.uploadedAt.toISOString(),
    };
  }

  const toPassageView = (row: PassageRecordRow): PassageView => ({
    id: row.id,
    document_id: row.documentId,
    position: row.position,
    page: row.page,
    start_offset: row.startOffset,
    end_offset: row.endOffset,
    text: row.text,
  });

  /** The counters of concepts come from shared-queries (ADR-0014): those tables are not ours. */
  async function toSubjectViews(
    actor: UserActor,
    subjects: SubjectRecord[],
  ): Promise<SubjectView[]> {
    const counts = await countSubjectConcepts(
      actor,
      db,
      subjects.map((subject) => subject.id),
      config.timezone,
    );
    return subjects.map((subject) => ({
      id: subject.id,
      name: subject.name,
      created_at: subject.createdAt.toISOString(),
      document_count: subject.documentCount,
      concept_count: counts.get(subject.id)?.concepts ?? 0,
      due_concept_count: counts.get(subject.id)?.dueConcepts ?? 0,
    }));
  }

  async function ownedSubject(actor: UserActor, subjectId: number): Promise<SubjectView> {
    const subject = await repository.findSubject(actor, subjectId);
    if (!subject) throw new AppError('NOT_FOUND');
    return (await toSubjectViews(actor, [subject]))[0]!;
  }

  async function ownedDocument(actor: UserActor, documentId: number) {
    const document = await repository.findDocument(actor, documentId);
    if (!document) throw new AppError('NOT_FOUND');
    return document;
  }

  /** Files are removed AFTER the database says so; a failure is logged and never undoes it. */
  async function removeFiles(
    userId: number,
    documents: { id: number; format: DocumentFormat }[],
  ): Promise<void> {
    for (const document of documents) {
      try {
        await files.remove(userId, document.id, document.format);
      } catch (error) {
        log.error({ err: error, document_id: document.id }, 'a stored file could not be removed');
      }
    }
  }

  // --- the user's events: the state machine decides, the repository writes ---------------

  /**
   * Applies a user event to a document. The state machine gives the next status (or the error
   * for an empty cell); `apply` writes it only if the row is still in the status it was read in.
   * When it is not, the document is read again and the event re-evaluated.
   */
  async function applyEvent<T>(
    actor: UserActor,
    documentId: number,
    event: UserEvent,
    apply: (current: DocumentRow, next: DocumentStatus) => Promise<T | null>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await ownedDocument(actor, documentId);
      const next = applyUserDocumentEvent(current.status as DocumentStatus, event);
      const result = await apply(current, next);
      if (result !== null) return result;
    }
    throw new AppError('CONFLICT');
  }

  // --- upload quota ------------------------------------------------------------------------

  async function quotaOf(actor: UserActor): Promise<UploadQuotaView> {
    const settings = await getSettings({ config, db });
    const bounds = await repository.dayBounds(now(), config.timezone);
    const used = await repository.countUploadsSince(actor, bounds.startsAt);
    return {
      limit: settings.uploads_per_day,
      used,
      remaining: Math.max(0, settings.uploads_per_day - used),
      resets_at: bounds.resetsAt.toISOString(),
      max_file_size_mb: settings.max_file_size_mb,
      max_pages: config.upload.maxPages,
    };
  }

  /** Design 2.5: the pages of a PDF, counted in a separate process, in limited time and memory. */
  async function countPdfPages(content: Buffer): Promise<PageCountOutcome> {
    try {
      return await pageCounter.count(content, {
        timeoutMs: config.documents.pageCountTimeoutSeconds * 1000,
        maxMemoryMb: config.documents.pageCountMemoryMb,
      });
    } catch (error) {
      // A defect of the counter does not block the upload; the analysis is the safety net.
      log.error({ err: error }, 'counting the pages of a PDF failed');
      return { kind: 'unreadable' };
    }
  }

  // --- the analysis of one claimed document --------------------------------------------------

  /** Why a document failed, as the code stored in `error_reason`. */
  function reasonOf(error: unknown, documentId: number): ErrorCode {
    if (error instanceof AppError && error.code in ERRORS) return error.code;
    log.error({ err: error, document_id: documentId }, 'the analysis of a document failed');
    return 'INTERNAL_ERROR';
  }

  async function processClaimed(
    claimed: NonNullable<Awaited<ReturnType<typeof repository.claimNext>>>,
    outerSignal: AbortSignal | undefined,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      config.documents.processingTimeoutSeconds * 1000,
    );
    const stopWithOuter = () => controller.abort();
    outerSignal?.addEventListener('abort', stopWithOuter, { once: true });
    const timedOut = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () =>
        reject(new AppError('DOCUMENT_PROCESSING_TIMEOUT')),
      );
    });
    timedOut.catch(() => undefined); // it only matters when it wins the race below

    const work = (async () => {
      if (!(await repository.hasPassages(claimed.id))) {
        // The text is extracted once; a reprocessing only repeats the analysis (Q47).
        const content = await files.read(claimed.userId, claimed.id, claimed.format);
        if (content === null) throw new Error('the stored file of the document is missing');
        const extracted = await extractor.extract(
          { format: claimed.format, content },
          controller.signal,
        );
        const structure = structureText(extracted, { maxPages: config.upload.maxPages });
        if (!(await repository.storeStructure(claimed, structure))) return; // C-08, C-10
      }
      await analyse({ documentId: claimed.id }, controller.signal);
    })();
    work.catch(() => undefined); // a result that comes after the race is lost is dropped

    try {
      await Promise.race([work, timedOut]);
      // PR: a late result changes nothing; the write is conditional on the claim.
      const ready = nextDocumentStatus('processing', 'processing_succeeded');
      if (ready !== null) await repository.finishClaimed(claimed, ready, null);
    } catch (error) {
      // The worker is shutting down: leave the document as it is; `failStuckDocuments` will
      // see it if nobody finishes it, and the shutdown must not be taken for a timeout.
      if (outerSignal?.aborted) return;
      // PE
      const failed = nextDocumentStatus('processing', 'processing_failed');
      if (failed !== null) {
        await repository.finishClaimed(claimed, failed, reasonOf(error, claimed.id));
      }
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', stopWithOuter);
    }
  }

  // --- the service -------------------------------------------------------------------------

  const service: DocumentsService = {
    // subjects (design 1)
    async listSubjects(actor, query) {
      const [total, subjects] = await Promise.all([
        repository.countSubjects(actor),
        repository.listSubjects(actor, {
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        }),
      ]);
      return { items: await toSubjectViews(actor, subjects), total };
    },

    async createSubject(actor, input) {
      const id = await repository.insertSubject(actor, input.name.trim());
      if (id === null) throw new AppError('SUBJECT_NAME_TAKEN');
      return ownedSubject(actor, id);
    },

    getSubject: ownedSubject,

    async renameSubject(actor, subjectId, input) {
      await ownedSubject(actor, subjectId);
      if (!(await repository.renameSubject(actor, subjectId, input.name.trim()))) {
        throw new AppError('SUBJECT_NAME_TAKEN');
      }
      return ownedSubject(actor, subjectId);
    },

    async deleteSubject(actor, subjectId) {
      const documents = await repository.deleteSubject(actor, subjectId);
      if (documents === null) throw new AppError('NOT_FOUND');
      await removeFiles(actor.userId, documents);
    },

    // upload (design 2)
    async uploadDocument(actor, subjectId, file: UploadedFile) {
      await ownedSubject(actor, subjectId); // 1
      const cleaned = cleanFileName(file.fileName);
      const format = formatOfName(cleaned);
      const unsupported = () =>
        new AppError('UNSUPPORTED_FILE_FORMAT', { allowed: ALLOWED_FORMATS });
      if (format === null) throw unsupported(); // 3

      if (!file.truncated) {
        if (file.content.length === 0) {
          throw new AppError('VALIDATION_ERROR', [
            { path: 'body/file', message: 'the file is empty' },
          ]); // 2
        }
        if (!contentMatchesFormat(format, file.content)) throw unsupported(); // 4
      }

      const settings = await getSettings({ config, db });
      const limits = { limit_mb: settings.max_file_size_mb, limit_pages: config.upload.maxPages };
      if (file.truncated || file.content.length > settings.max_file_size_mb * 1024 * 1024) {
        throw new AppError('FILE_TOO_LARGE', { exceeded: 'size', ...limits }); // 5
      }

      if (format === 'pdf') {
        // 6: the pages, before the daily limit, and only for a PDF.
        const outcome = await countPdfPages(file.content);
        if (outcome.kind === 'pages' && outcome.pages > config.upload.maxPages) {
          throw new AppError('FILE_TOO_LARGE', {
            exceeded: 'pages',
            ...limits,
            pages: outcome.pages,
          });
        }
        if (outcome.kind === 'timeout' || outcome.kind === 'memory') {
          throw new AppError(
            'FILE_TOO_LARGE',
            { exceeded: 'complexity', reason: outcome.kind, ...limits },
            COMPLEXITY_MESSAGE,
          );
        }
      }

      // 7: the limit and the insert are one step per student; the file is written before the
      // commit, so a document never exists without its file.
      const bounds = await repository.dayBounds(now(), config.timezone);
      let created: DocumentRow | undefined;
      try {
        await repository.transaction(async (tx) => {
          await tx.lockUploads(actor);
          const used = await tx.countUploadsSince(actor, bounds.startsAt);
          if (used >= settings.uploads_per_day) {
            throw new AppError('DAILY_UPLOAD_LIMIT_REACHED', {
              limit: settings.uploads_per_day,
              resets_at: bounds.resetsAt.toISOString(),
            });
          }
          created = await tx.insertDocument({
            subjectId,
            fileName: storedFileName(cleaned),
            format,
            sizeBytes: file.content.length,
          });
          await files.write(actor.userId, created.id, format, file.content);
        });
      } catch (error) {
        if (created) await removeFiles(actor.userId, [{ id: created.id, format }]);
        throw error;
      }
      return toDocumentView(created!);
    },

    getUploadQuota: quotaOf,

    // documents (design 5, 6)
    async listDocuments(actor, query) {
      if (query.subjectId !== undefined) await ownedSubject(actor, query.subjectId);
      const { items, total } = await repository.listDocuments(actor, {
        ...(query.subjectId !== undefined ? { subjectId: query.subjectId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      });
      return { items: items.map(toDocumentView), total };
    },

    async getDocument(actor, documentId) {
      return toDocumentView(await ownedDocument(actor, documentId));
    },
    async getOwnedDocument(actor, documentId) {
      return toDocumentView(await ownedDocument(actor, documentId));
    },

    async renameDocument(actor, documentId, input) {
      const fileName = storedFileName(cleanFileName(input.fileName));
      if (fileName === '') {
        throw new AppError('VALIDATION_ERROR', [
          { path: 'body/file_name', message: 'the name is empty' },
        ]);
      }
      const renamed = await applyEvent(actor, documentId, 'renamed', (current) =>
        repository.renameDocument(documentId, current.status as DocumentStatus, fileName),
      );
      return toDocumentView(renamed);
    },

    async deleteDocument(actor, documentId) {
      const removed = await applyEvent(actor, documentId, 'deleted', async (current, next) =>
        next === 'deleted' &&
        (await repository.markDeleted(documentId, current.status as DocumentStatus, now()))
          ? current
          : null,
      );
      await removeFiles(actor.userId, [
        { id: removed.id, format: removed.format as DocumentFormat },
      ]);
    },

    async reprocessDocument(actor, documentId) {
      const queued = await applyEvent(actor, documentId, 'reprocess_requested', (current, next) =>
        repository.requeue(documentId, current.status as DocumentStatus, next),
      );
      return toDocumentView(queued);
    },

    async openDocumentFile(actor, documentId): Promise<DocumentFile> {
      const document = await ownedDocument(actor, documentId);
      const format = document.format as DocumentFormat;
      const opened = await files.open(actor.userId, document.id, format);
      if (!opened) {
        log.error({ document_id: document.id }, 'the stored file of a document is missing');
        throw new AppError('NOT_FOUND');
      }
      return {
        contentType: CONTENT_TYPES[format],
        fileName: document.fileName,
        sizeBytes: opened.sizeBytes,
        stream: opened.stream,
      };
    },

    async listPassages(actor, documentId, query) {
      const document = await ownedDocument(actor, documentId);
      if (document.status !== 'ready') throw new AppError('DOCUMENT_NOT_READY');
      const [total, rows] = await Promise.all([
        repository.countPassages(documentId, query.pageNumber),
        repository.listPassages(documentId, {
          ...(query.pageNumber !== undefined ? { pageNumber: query.pageNumber } : {}),
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        }),
      ]);
      return { items: rows.map(toPassageView), total };
    },

    // for the analysis and content modules (design 7)
    async getPassagesByIds(actor, documentId, passageIds) {
      await ownedDocument(actor, documentId);
      const wanted = new Set(passageIds);
      const rows = await repository.passagesByIds(documentId, [...wanted]);
      if (rows.length !== wanted.size) throw new AppError('NOT_FOUND'); // one is not in this document
      return rows.map(toPassageView);
    },

    async getDocumentStructure(actor, documentId) {
      await ownedDocument(actor, documentId);
      const structure = await repository.structureOf(documentId);
      if (!structure) throw new AppError('DOCUMENT_NOT_READY');
      return structure;
    },

    getStructureForAnalysis: (documentId) => repository.structureOf(documentId),

    // background work (design 4, 9)
    async processNextDocument(signal) {
      const started = nextDocumentStatus('queued', 'processing_started');
      if (started === null) return false;
      const claimed = await repository.claimNext(started);
      if (!claimed) return false;
      await processClaimed(claimed, signal);
      return true;
    },

    async failStuckDocuments() {
      const failed = nextDocumentStatus('processing', 'processing_failed');
      if (failed === null) return 0;
      const cutoff = new Date(now().getTime() - config.documents.processingTimeoutSeconds * 1000);
      return repository.failProcessingStartedBefore(cutoff, failed, 'DOCUMENT_PROCESSING_TIMEOUT');
    },

    async purgeDeletedDocuments() {
      const cutoff = new Date(now().getTime() - config.documents.deletedRetentionHours * HOUR_MS);
      return repository.deleteDeletedBefore(cutoff);
    },

    async removeOrphanFiles() {
      const cutoff = now().getTime() - ORPHAN_MIN_AGE_MS;
      const stored = await files.scan();
      const users = await repository.existingUserIds(stored.map((directory) => directory.userId));
      let removed = 0;
      for (const directory of stored) {
        const userExists = users.has(directory.userId);
        const live = userExists
          ? await repository.liveDocumentIds(
              directory.files.flatMap((file) =>
                file.documentId === null ? [] : [file.documentId],
              ),
            )
          : new Set<number>();
        for (const file of directory.files) {
          if (file.modifiedAt >= cutoff || file.documentId === null) continue; // too new, or not ours
          if (userExists && live.has(file.documentId)) continue;
          await files.removeScannedFile(directory.userId, file.name);
          removed += 1;
        }
        if (!userExists && directory.files.every((file) => file.modifiedAt < cutoff)) {
          await files.removeScannedDirectory(directory.userId);
        }
      }
      return removed;
    },

    // for the auth module (design 8; Q43)
    userFiles: {
      deleteAllForUser: (userId) => files.removeUserDirectory(userId),
    },
  };
  return service;
}

/**
 * Background tasks of the module (design 9), registered in `src/worker.ts` (Segment 2C).
 *
 * `process-queue` takes one document at a time and, when the worker is told to stop, takes no new
 * one but lets the document in hand FINISH: it is not given the stop signal. The document is
 * bounded by its own time limit (DOCUMENT_PROCESSING_TIMEOUT_SECONDS), so the stop waits at most
 * that long; this is why the container's `stop_grace_period` must be longer than the limit
 * (docs/design/documents.md, 9). Handing it the signal instead would kill the child process that
 * reads a PDF, and the document would end as an error that was nobody's fault.
 */
export function documentsWorkerTasks(
  service: DocumentsService,
  options: { pollIntervalMs?: number } = {},
): WorkerTask[] {
  return [
    {
      name: 'documents:process-queue',
      intervalMs: options.pollIntervalMs ?? 1_000,
      run: async (signal) => {
        // The stop signal is looked at BETWEEN documents only.
        while (!signal.aborted && (await service.processNextDocument())) {
          // one document after the other, until the queue is empty
        }
      },
    },
    {
      name: 'documents:fail-stuck',
      intervalMs: 10_000,
      run: async () => void (await service.failStuckDocuments()),
    },
    {
      name: 'documents:purge-deleted',
      intervalMs: HOUR_MS,
      run: async () => void (await service.purgeDeletedDocuments()),
    },
    {
      name: 'documents:remove-orphan-files',
      intervalMs: 24 * HOUR_MS,
      run: async () => void (await service.removeOrphanFiles()),
    },
  ];
}
