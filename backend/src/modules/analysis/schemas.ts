import { z } from 'zod';
import { Mastery, MasteryStatusEnum, Passage } from '../../core/api-schemas.js';
import { CONCEPT_ORIGINS } from '../../core/domain.js';
import { Id, IdParam, PaginationQuery, Timestamp, paginated } from '../../core/http.js';

const ConceptName = z.string().trim().min(1).max(80);
const ConceptDefinition = z.string().trim().max(300);

/** A saved concept always has verified sources (RF9): unverified ones are never stored. */
export const Concept = z
  .object({
    id: Id,
    subject_id: Id,
    document_id: Id.describe('Document of its source passages (derived, not stored)'),
    name: ConceptName,
    definition: ConceptDefinition,
    origin: z.enum(CONCEPT_ORIGINS),
    passage_count: z.int().min(1),
    mastery: Mastery,
    mastery_status: MasteryStatusEnum,
    created_at: Timestamp,
  })
  .meta({ id: 'Concept' });

export const ConceptDetail = Concept.extend({
  passages: z.array(Passage).min(1).describe('Source passages, to be highlighted (RF5)'),
}).meta({ id: 'ConceptDetail' });

export const ConceptList = paginated(Concept, 'ConceptList');
export const ConceptParams = z.object({ concept_id: IdParam });

export const ConceptListQuery = PaginationQuery.extend({
  subject_id: IdParam.optional(),
  document_id: IdParam.optional(),
  mastery_status: MasteryStatusEnum.optional(),
});

/** RF8: manual concept = name, definition, at least one selected passage. */
export const ConceptCreate = z
  .object({
    name: ConceptName,
    definition: ConceptDefinition,
    passage_ids: z
      .array(Id)
      .min(1)
      .max(50)
      .describe('Passages of ONE document owned by the student'),
  })
  .meta({ id: 'ConceptCreate' });

export const ConceptUpdate = z
  .object({ name: ConceptName, definition: ConceptDefinition })
  .partial()
  .meta({ id: 'ConceptUpdate' });

export const ConceptMerge = z
  .object({
    source_concept_id: Id.describe(
      'Concept merged INTO the one in the path, then deleted; its passages are united (RF8)',
    ),
  })
  .meta({ id: 'ConceptMerge' });
