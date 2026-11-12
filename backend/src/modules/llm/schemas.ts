import { z } from 'zod';
import { DIFFICULTIES, MATERIAL_TYPES } from '../../core/domain.js';

/**
 * Input and output of the three model operations (SRS 3.1.3, Tabelul 3.3).
 *
 * The *Output schemas are the "required JSON format" of decision rule R1 (condition C1):
 * a model reply that does not parse with them is an invalid response. They check FORMAT only.
 * Whether a passage id exists or a quote is found in its passage (C2, C3) is decided by
 * source verification in the analysis module, never here.
 */

// --- extract concepts (RF7) -----------------------------------------------------------------

export const ExtractConceptsInput = z.object({
  passages: z
    .array(
      z.object({
        id: z.int().positive(),
        page: z.int().min(1),
        text: z.string().min(1),
      }),
    )
    .min(1),
});

export const ExtractConceptsOutput = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        definition: z.string().trim().max(300),
        passage_ids: z.array(z.int().positive()).min(1),
      }),
    )
    .max(100),
});

// --- generate materials (RF10, RF12) --------------------------------------------------------

export const GenerateMaterialsInput = z.object({
  concept: z.object({
    name: z.string().min(1).max(80),
    definition: z.string().max(300),
  }),
  passages: z.array(z.object({ id: z.int().positive(), text: z.string().min(1) })).min(1),
  type: z.enum(MATERIAL_TYPES),
  count: z.int().min(1).max(20),
  difficulty: z.enum(DIFFICULTIES),
});

export const GeneratedMaterial = z
  .object({
    type: z.enum(MATERIAL_TYPES),
    statement: z.string().trim().min(1),
    /** Null only for summaries. For true_false: "true" | "false". */
    answer: z.string().trim().min(1).nullable(),
    explanation: z.string().trim().nullable(),
    /** Exactly 4 for multiple_choice (RF12), otherwise null. */
    options: z.array(z.string().trim().min(1)).length(4).nullable(),
    passage_id: z.int().positive(),
    quote: z.string().trim().min(1),
  })
  .superRefine((material, ctx) => {
    if (material.type === 'multiple_choice') {
      if (!material.options) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'multiple_choice needs 4 options',
        });
      } else if (material.answer === null || !material.options.includes(material.answer)) {
        ctx.addIssue({
          code: 'custom',
          path: ['answer'],
          message: 'answer must be one of the options',
        });
      }
    } else if (material.options !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'options are only for multiple_choice',
      });
    }
    if (
      material.type === 'true_false' &&
      material.answer !== 'true' &&
      material.answer !== 'false'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['answer'],
        message: 'true_false answer must be "true" or "false"',
      });
    }
    if (material.type !== 'summary' && material.answer === null) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'answer is required' });
    }
  });

export const GenerateMaterialsOutput = z.object({
  materials: z.array(GeneratedMaterial).max(20),
});

// --- evaluate a short answer (RF13) ---------------------------------------------------------

export const EvaluateAnswerInput = z.object({
  question: z.string().min(1),
  reference_answer: z.string().min(1),
  passage_text: z.string().min(1),
  student_answer: z.string(),
});

export const EvaluateAnswerOutput = z.object({
  verdict: z.enum(['complete', 'partial', 'incorrect']),
  explanation: z.string().trim().max(200),
});

export type ExtractConceptsInput = z.infer<typeof ExtractConceptsInput>;
export type ExtractConceptsOutput = z.infer<typeof ExtractConceptsOutput>;
export type GenerateMaterialsInput = z.infer<typeof GenerateMaterialsInput>;
export type GeneratedMaterial = z.infer<typeof GeneratedMaterial>;
export type GenerateMaterialsOutput = z.infer<typeof GenerateMaterialsOutput>;
export type EvaluateAnswerInput = z.infer<typeof EvaluateAnswerInput>;
export type EvaluateAnswerOutput = z.infer<typeof EvaluateAnswerOutput>;
