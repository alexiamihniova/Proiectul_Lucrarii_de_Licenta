import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { UserActor } from '../../core/actor.js';
import { AppError } from '../../core/errors.js';
import { Passage } from '../../core/api-schemas.js';
import { NoContent, PaginationQuery, endpoint, paginated } from '../../core/http.js';
import {
  Document,
  DocumentList,
  DocumentListQuery,
  DocumentParams,
  DocumentRename,
  PassageListQuery,
  Subject,
  SubjectList,
  SubjectParams,
  SubjectWrite,
  UploadQuota,
} from './schemas.js';

const tag = 'documents';

/** The hook sets the actor on every route that is not public; this only narrows the type. */
function requireActor(request: FastifyRequest): UserActor {
  if (!request.actor) throw new AppError('UNAUTHENTICATED');
  return request.actor;
}

const missingFile = (message: string) =>
  new AppError('VALIDATION_ERROR', [{ path: 'body/file', message }]);

/** RFC 5987 `attr-char`: what `encodeURIComponent` leaves is not enough (' ( ) * stay). */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const PassageList = paginated(Passage, 'PassageList');

/** Segment 2 — UC-04 „Gestionează materiile și documentele” (RF3–RF6). */
export const documentsRouter: FastifyPluginAsyncZod = async (app) => {
  // --- subjects ---------------------------------------------------------------------------

  app.route({
    method: 'GET',
    url: '/subjects',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'listSubjects',
        summary: 'List own subjects',
        tag,
        auth: 'student',
      },
      { querystring: PaginationQuery, response: { 200: SubjectList } },
    ),
    handler: async (request) => {
      const { page, page_size: pageSize } = request.query;
      const result = await app.documents.listSubjects(requireActor(request), { page, pageSize });
      return { ...result, page, page_size: pageSize };
    },
  });

  app.route({
    method: 'POST',
    url: '/subjects',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'createSubject',
        summary: 'Create a subject',
        description: 'RF3. Errors: `SUBJECT_NAME_TAKEN`.',
        tag,
        auth: 'student',
        errors: [409],
      },
      { body: SubjectWrite, response: { 201: Subject } },
    ),
    handler: async (request, reply) =>
      reply.code(201).send(await app.documents.createSubject(requireActor(request), request.body)),
  });

  app.route({
    method: 'GET',
    url: '/subjects/:subject_id',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'getSubject',
        summary: 'Read a subject',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: SubjectParams, response: { 200: Subject } },
    ),
    handler: async (request) =>
      app.documents.getSubject(requireActor(request), request.params.subject_id),
  });

  app.route({
    method: 'PATCH',
    url: '/subjects/:subject_id',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'renameSubject',
        summary: 'Rename a subject',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: SubjectParams, body: SubjectWrite, response: { 200: Subject } },
    ),
    handler: async (request) =>
      app.documents.renameSubject(requireActor(request), request.params.subject_id, request.body),
  });

  app.route({
    method: 'DELETE',
    url: '/subjects/:subject_id',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'deleteSubject',
        summary: 'Delete a subject and everything in it',
        description:
          'RF3. Removes its documents, passages, concepts, materials, tests, answers, progress and reviews. The UI confirms first (M10).',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: SubjectParams, response: { 204: NoContent } },
    ),
    handler: async (request, reply) => {
      await app.documents.deleteSubject(requireActor(request), request.params.subject_id);
      return reply.code(204).send();
    },
  });

  // --- documents --------------------------------------------------------------------------

  app.route({
    method: 'POST',
    url: '/subjects/:subject_id/documents',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'uploadDocument',
        summary: 'Upload a PDF, DOCX or TXT file into a subject',
        description:
          'RF3, RF4, EV1. `multipart/form-data` with one part named `file`. The document is created with status `queued` and analysed in the background. Errors: `UNSUPPORTED_FILE_FORMAT` (M04, 415), `FILE_TOO_LARGE` (M05, 413), `DAILY_UPLOAD_LIMIT_REACHED` (M08, 429). C-03: `details` carries the violated limit.',
        tag,
        auth: 'student',
        errors: [404, 413, 415, 429],
      },
      { params: SubjectParams, response: { 201: Document } },
    ),
    handler: async (request, reply) => {
      if (!request.isMultipart())
        throw missingFile('multipart/form-data with a file part is required');
      const part = await request.file();
      if (!part || part.fieldname !== 'file' || !part.filename) {
        throw missingFile('the file part is missing');
      }
      let content: Buffer = Buffer.alloc(0);
      let truncated: boolean;
      try {
        content = await part.toBuffer();
        truncated = part.file.truncated;
      } catch (error) {
        // The transport stopped the file at UPLOAD_HARD_LIMIT_MB: it is simply too large.
        if ((error as { code?: string }).code !== 'FST_REQ_FILE_TOO_LARGE') throw error;
        truncated = true;
      }
      const document = await app.documents.uploadDocument(
        requireActor(request),
        request.params.subject_id,
        { fileName: part.filename, content, truncated },
      );
      return reply.code(201).send(document);
    },
  });

  app.route({
    method: 'GET',
    url: '/documents',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'listDocuments',
        summary: 'List own documents',
        description: 'RF6. Deleted documents are never returned.',
        tag,
        auth: 'student',
      },
      { querystring: DocumentListQuery, response: { 200: DocumentList } },
    ),
    handler: async (request) => {
      const { page, page_size: pageSize, subject_id: subjectId, status } = request.query;
      const result = await app.documents.listDocuments(requireActor(request), {
        page,
        pageSize,
        ...(subjectId !== undefined ? { subjectId } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      return { ...result, page, page_size: pageSize };
    },
  });

  app.route({
    method: 'GET',
    url: '/documents/upload-quota',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'getUploadQuota',
        summary: 'Daily upload quota and current limits',
        description: 'C-07: the counter resets at 00:00 Europe/Chisinau.',
        tag,
        auth: 'student',
      },
      { response: { 200: UploadQuota } },
    ),
    handler: async (request) => app.documents.getUploadQuota(requireActor(request)),
  });

  app.route({
    method: 'GET',
    url: '/documents/:document_id',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'getDocument',
        summary: 'Read a document and its current status',
        description:
          'C-02: the frontend polls this route (every ≤ 3 s) while status is `queued` or `processing`.',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: DocumentParams, response: { 200: Document } },
    ),
    handler: async (request, reply) => {
      // The interface polls this route (C-02, Q13): an old answer must never be reused.
      reply.header('cache-control', 'no-store');
      return app.documents.getDocument(requireActor(request), request.params.document_id);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/documents/:document_id',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'renameDocument',
        summary: 'Rename a document',
        description: 'RF6, event RD: allowed in every state, does not change the status.',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: DocumentParams, body: DocumentRename, response: { 200: Document } },
    ),
    handler: async (request) =>
      app.documents.renameDocument(requireActor(request), request.params.document_id, {
        fileName: request.body.file_name,
      }),
  });

  app.route({
    method: 'DELETE',
    url: '/documents/:document_id',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'deleteDocument',
        summary: 'Delete a document',
        description:
          'RF6, event ȘT, EV17. Allowed in every state; a running analysis is cancelled and late results are ignored (C-08). The UI confirms first (M10).',
        tag,
        auth: 'student',
        errors: [404],
      },
      { params: DocumentParams, response: { 204: NoContent } },
    ),
    handler: async (request, reply) => {
      await app.documents.deleteDocument(requireActor(request), request.params.document_id);
      return reply.code(204).send();
    },
  });

  app.route({
    method: 'POST',
    url: '/documents/:document_id/reprocess',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'reprocessDocument',
        summary: 'Queue a document for analysis again',
        description:
          'RF6, event RP: only from `ready` or `error`. Errors: `DOCUMENT_ALREADY_PROCESSING` when it is `queued` or `processing` (C-09).',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: DocumentParams, response: { 202: Document } },
    ),
    handler: async (request, reply) =>
      reply
        .code(202)
        .send(
          await app.documents.reprocessDocument(requireActor(request), request.params.document_id),
        ),
  });

  app.route({
    method: 'GET',
    url: '/documents/:document_id/file',
    ...endpoint(
      {
        uc: ['UC-04'],
        operationId: 'downloadDocumentFile',
        summary: 'Download the original file (for the built-in viewer)',
        description: 'RF5. The `Content-Type` is the one of the uploaded file.',
        tag,
        auth: 'student',
        errors: [404],
      },
      {
        params: DocumentParams,
        response: {
          200: {
            description: 'The original file',
            content: {
              'application/octet-stream': { schema: z.string().meta({ format: 'binary' }) },
            },
          },
        },
      },
    ),
    handler: async (request, reply) => {
      const file = await app.documents.openDocumentFile(
        requireActor(request),
        request.params.document_id,
      );
      return (
        reply
          .header('content-type', file.contentType)
          .header('content-length', file.sizeBytes)
          .header('content-disposition', `inline; filename*=UTF-8''${encodeRfc5987(file.fileName)}`)
          // A stored file is shown, never run: no guessing of its type, no scripts, no caching.
          .header('x-content-type-options', 'nosniff')
          .header('content-security-policy', 'sandbox')
          .header('cache-control', 'private, no-store')
          .send(file.stream as never)
      );
    },
  });

  app.route({
    method: 'GET',
    url: '/documents/:document_id/passages',
    ...endpoint(
      {
        uc: ['UC-04', 'UC-17'],
        operationId: 'listDocumentPassages',
        summary: 'List the passages of a document, in order',
        description: 'RF4, RF5. Errors: `DOCUMENT_NOT_READY` while the document is not `ready`.',
        tag,
        auth: 'student',
        errors: [404, 409],
      },
      { params: DocumentParams, querystring: PassageListQuery, response: { 200: PassageList } },
    ),
    handler: async (request) => {
      const { page, page_size: pageSize, page_number: pageNumber } = request.query;
      const result = await app.documents.listPassages(
        requireActor(request),
        request.params.document_id,
        { page, pageSize, ...(pageNumber !== undefined ? { pageNumber } : {}) },
      );
      return { ...result, page, page_size: pageSize };
    },
  });
};
