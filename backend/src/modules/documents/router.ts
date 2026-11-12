import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Passage } from '../../core/api-schemas.js';
import {
  NoContent,
  PaginationQuery,
  endpoint,
  notImplemented,
  paginated,
} from '../../core/http.js';
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
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
    handler: notImplemented,
  });
};
