import { z } from 'zod';
import {
  DifficultyEnum,
  Mastery,
  MasteryStatusEnum,
  MaterialTypeEnum,
  Source,
} from '../../core/api-schemas.js';
import { MATERIAL_STATUSES, REPORT_STATUSES } from '../../core/domain.js';
import { Id, IdParam, PaginationQuery, Timestamp, paginated } from '../../core/http.js';

// --- materials (RF10) -----------------------------------------------------------------------

export const Material = z
  .object({
    id: Id,
    concept_id: Id,
    passage_id: Id,
    type: MaterialTypeEnum,
    statement: z.string().describe('Summary text, flashcard front, or question'),
    correct_answer: z
      .string()
      .nullable()
      .describe('Null for summaries; "true"/"false" for true_false'),
    options: z.array(z.string()).length(4).nullable().describe('multiple_choice only'),
    explanation: z.string().nullable(),
    quote: z.string().nullable(),
    source_verified: z.boolean(),
    status: z.enum(MATERIAL_STATUSES),
    created_at: Timestamp,
  })
  .meta({ id: 'Material' });

export const MaterialList = paginated(Material, 'MaterialList');
export const MaterialParams = z.object({ material_id: IdParam });

export const MaterialListQuery = PaginationQuery.extend({
  subject_id: IdParam.optional(),
  document_id: IdParam.optional(),
  concept_id: IdParam.optional(),
  type: MaterialTypeEnum.optional(),
  status: z.enum(MATERIAL_STATUSES).optional(),
});

/** UC-06 step 1 */
export const GenerateMaterialsRequest = z
  .object({
    document_id: Id,
    type: z
      .enum(['summary', 'flashcard', 'multiple_choice', 'open'])
      .describe('The four types a student can ask for (RF10)'),
    concept_ids: z.array(Id).min(1).max(20),
    count: z.int().min(1).max(20).describe('Materials per request'),
    difficulty: DifficultyEnum.default('medium'),
  })
  .meta({ id: 'GenerateMaterialsRequest' });

/** UC-06 steps 5–7, decision rules R1–R5. */
export const GenerateMaterialsResponse = z
  .object({
    items: z.array(Material).describe('Saved, verified materials (R5)'),
    rejected_unverified_count: z
      .int()
      .min(0)
      .describe('Rejected by R3/R4: source not verified (M09, C-15). Not saved.'),
    ignored_duplicate_count: z.int().min(0).describe('Ignored by R2 (C-13)'),
  })
  .meta({ id: 'GenerateMaterialsResponse' });

// --- reports (RF12, UC-08) ------------------------------------------------------------------

export const ReportCreate = z
  .object({ reason: z.string().trim().min(1).max(300) })
  .meta({ id: 'ReportCreate' });

export const Report = z
  .object({
    id: Id,
    material_id: Id,
    reason: z.string(),
    status: z.enum(REPORT_STATUSES),
    created_at: Timestamp,
  })
  .meta({ id: 'Report' });

// --- tests (RF11–RF13, UC-07) ---------------------------------------------------------------

const TestQuestionType = z.enum(['multiple_choice', 'true_false', 'open']);

/** RF11. Stored as-is in `tests.config`. */
export const TestConfig = z
  .object({
    subject_id: Id,
    document_id: Id.optional().describe('Restrict the test to one document of the subject'),
    concept_ids: z.array(Id).min(1).max(100).optional().describe('Default: all concepts in scope'),
    question_count: z.int().min(5).max(30),
    types: z.array(TestQuestionType).min(1).describe('open = „răspuns scurt”'),
    difficulty: DifficultyEnum,
    only_due: z.boolean().default(false).describe('„doar conceptele de recapitulat”'),
  })
  .meta({ id: 'TestConfig' });

/** A question as shown during the test: no answer, no explanation. */
export const TestQuestion = z
  .object({
    material_id: Id,
    concept_id: Id,
    type: TestQuestionType,
    statement: z.string(),
    options: z.array(z.string()).length(4).nullable(),
    answered: z.boolean(),
  })
  .meta({ id: 'TestQuestion' });

export const Test = z
  .object({
    id: Id,
    subject_id: Id,
    config: TestConfig,
    started_at: Timestamp,
    finished_at: Timestamp.nullable(),
    total_score: z.number().min(0).max(100).nullable().describe('Null until finished (C-05)'),
    question_count: z.int().min(0),
    answered_count: z.int().min(0),
  })
  .meta({ id: 'Test' });

export const TestDetail = Test.extend({ questions: z.array(TestQuestion) }).meta({
  id: 'TestDetail',
});
export const TestList = paginated(Test, 'TestList');
export const TestParams = z.object({ test_id: IdParam });
export const TestListQuery = PaginationQuery.extend({ subject_id: IdParam.optional() });

export const AnswerRequest = z
  .object({
    material_id: Id,
    answer: z
      .string()
      .max(2000)
      .describe('Chosen option text, "true"/"false", or the free-text short answer'),
  })
  .meta({ id: 'AnswerRequest' });

export const Verdict = z.enum(['correct', 'partial', 'incorrect', 'unevaluated']).meta({
  id: 'Verdict',
  description:
    'correct = corect/complet (c = 1); partial = parțial (0.5); incorrect = greșit/incorect (0); unevaluated = „neevaluat”, the model was unavailable (C-04)',
});

/** UC-07 step 5: feedback after each answer. */
export const AnswerFeedback = z
  .object({
    answer_id: Id,
    material_id: Id,
    verdict: Verdict,
    correct_answer: z.string(),
    explanation: z.string().nullable(),
    source: Source,
  })
  .meta({ id: 'AnswerFeedback' });

/** RF13, SRS 3.2.4.5. */
export const TestResult = z
  .object({
    test_id: Id,
    finished_at: Timestamp,
    total_score: z
      .number()
      .min(0)
      .max(100)
      .describe('100 × Σc / number of EVALUATED questions (C-04)'),
    unevaluated_count: z.int().min(0),
    questions: z.array(
      z.object({
        material_id: Id,
        concept_id: Id,
        type: TestQuestionType,
        statement: z.string(),
        given_answer: z.string().nullable().describe('Null when the question was skipped'),
        correct_answer: z.string(),
        explanation: z.string().nullable(),
        verdict: Verdict,
        score: z.number().min(0).max(1).nullable(),
        source: Source,
      }),
    ),
    concepts: z.array(
      z.object({
        concept_id: Id,
        name: z.string(),
        score: z.number().min(0).max(100).describe('Score on this concept in this test'),
        mastery: Mastery,
        mastery_status: MasteryStatusEnum,
      }),
    ),
    newly_mastered_concept_ids: z
      .array(Id)
      .describe('Concepts that crossed the upper threshold: show confetti once (RF17)'),
  })
  .meta({ id: 'TestResult' });
