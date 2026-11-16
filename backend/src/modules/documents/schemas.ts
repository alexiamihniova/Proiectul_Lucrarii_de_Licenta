import { z } from 'zod';
import { DOCUMENT_FORMATS } from '../../core/domain.js';
import { ERROR_CODES } from '../../core/errors.js';
import { Id, IdParam, PaginationQuery, Timestamp, paginated } from '../../core/http.js';

/** The API never returns deleted documents, so `deleted` is not part of the public enum. */
export const DocumentStatusEnum = z.enum(['queued', 'processing', 'ready', 'error']).meta({
  id: 'DocumentStatus',
  description: 'În coadă, În analiză, Gata, Eroare',
});

const SubjectName = z.string().trim().min(1).max(100);

export const Subject = z
  .object({
    id: Id,
    name: SubjectName,
    created_at: Timestamp,
    document_count: z.int().min(0),
    concept_count: z.int().min(0),
    due_concept_count: z.int().min(0).describe('Concepts due for review today (RF16)'),
  })
  .meta({ id: 'Subject' });

export const SubjectList = paginated(Subject, 'SubjectList');
export const SubjectWrite = z.object({ name: SubjectName }).meta({ id: 'SubjectWrite' });
export const SubjectParams = z.object({ subject_id: IdParam });

export const Document = z
  .object({
    id: Id,
    subject_id: Id,
    file_name: z.string(),
    format: z.enum(DOCUMENT_FORMATS),
    size_bytes: z.int().positive(),
    page_count: z.int().min(1).nullable().describe('Null until the text is extracted'),
    status: DocumentStatusEnum,
    error: z
      .object({ code: z.enum(ERROR_CODES), message: z.string() })
      .nullable()
      .describe('Why the analysis failed; set only when status = error (e.g. M06, M07)'),
    uploaded_at: Timestamp,
  })
  .meta({ id: 'Document' });

export const DocumentList = paginated(Document, 'DocumentList');
export const DocumentParams = z.object({ document_id: IdParam });

export const DocumentListQuery = PaginationQuery.extend({
  subject_id: IdParam.optional(),
  status: DocumentStatusEnum.optional(),
});

export const DocumentRename = z
  .object({ file_name: z.string().trim().min(1).max(255) })
  .meta({ id: 'DocumentRename' });

/** C-07 */
export const UploadQuota = z
  .object({
    limit: z.int().min(1).describe('Uploads allowed per day'),
    used: z.int().min(0),
    remaining: z.int().min(0),
    resets_at: Timestamp.describe('Next 00:00 Europe/Chisinau'),
    max_file_size_mb: z.int().min(1),
    max_pages: z.int().min(1),
  })
  .meta({ id: 'UploadQuota' });

export const PassageListQuery = PaginationQuery.extend({
  page_number: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Only passages on this page of the document'),
});
