import { z } from 'zod';
import { DIFFICULTIES, MASTERY_STATUSES, MATERIAL_TYPES } from './domain.js';
import { Id } from './http.js';

/**
 * API shapes used by more than one module. A module's own request/response shapes live in
 * its `schemas.ts`; anything shared goes here, because modules never import each other's
 * `schemas.ts`.
 */

export const Passage = z
  .object({
    id: Id,
    document_id: Id,
    position: z.int().min(0).describe('0-based order of the passage in the document'),
    page: z.int().min(1),
    start_offset: z.int().min(0).describe('Character offset in the cleaned document text'),
    end_offset: z.int().min(1),
    text: z.string(),
  })
  .meta({ id: 'Passage' });

/** What the „Sursă” button shows (RF5, RF9, RF10): the verified passage and the quote in it. */
export const Source = z
  .object({
    document: z.object({ id: Id, file_name: z.string() }),
    passage: Passage,
    quote: z.string().nullable().describe('Verbatim excerpt of the passage, when there is one'),
  })
  .meta({ id: 'Source' });

export const MaterialTypeEnum = z.enum(MATERIAL_TYPES).meta({ id: 'MaterialType' });
export const DifficultyEnum = z.enum(DIFFICULTIES).meta({ id: 'Difficulty' });
export const MasteryStatusEnum = z.enum(MASTERY_STATUSES).meta({
  id: 'MasteryStatus',
  description: 'new = no answers; to_review = S < low; in_progress; mastered = S > high',
});
export const Mastery = z.int().min(0).max(100).describe('Mastery S, 0–100 (RB2)');
