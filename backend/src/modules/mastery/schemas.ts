import { z } from 'zod';
import { Mastery, MasteryStatusEnum, MaterialTypeEnum, Source } from '../../core/api-schemas.js';
import { DateOnly, Id, IdParam, PaginationQuery, Timestamp, paginated } from '../../core/http.js';

export const SubjectScopeQuery = z.object({
  subject_id: IdParam.optional().describe('Default: all subjects of the student'),
});

/** RF14 */
export const ConceptProgress = z
  .object({
    concept_id: Id,
    subject_id: Id,
    name: z.string(),
    mastery: Mastery,
    status: MasteryStatusEnum,
    answer_count: z.int().min(0),
    next_review_date: DateOnly.nullable().describe('Null while the concept has no answers'),
    updated_at: Timestamp.nullable(),
  })
  .meta({ id: 'ConceptProgress' });

export const ConceptProgressList = paginated(ConceptProgress, 'ConceptProgressList');
export const ConceptProgressQuery = PaginationQuery.extend({
  subject_id: IdParam.optional(),
  status: MasteryStatusEnum.optional(),
});

/** RF15: coverage, streak, daily goal. */
export const ProgressSummary = z
  .object({
    concept_count: z.int().min(0),
    by_status: z.object({
      new: z.int().min(0),
      to_review: z.int().min(0),
      in_progress: z.int().min(0),
      mastered: z.int().min(0),
    }),
    coverage_percent: z.int().min(0).max(100).describe('Concepts with at least one answer'),
    streak_days: z.int().min(0).describe('Consecutive days with study, ending today or yesterday'),
    daily_goal: z.int().min(5).max(100),
    reviews_done_today: z.int().min(0),
    due_today_count: z.int().min(0),
    thresholds: z.object({ low: z.int().min(0).max(100), high: z.int().min(0).max(100) }),
  })
  .meta({ id: 'ProgressSummary' });

/** RF15: radar chart; the UI draws it only with 3 or more concepts. */
export const ProgressRadar = z
  .object({
    items: z.array(z.object({ concept_id: Id, name: z.string(), mastery: Mastery })),
  })
  .meta({ id: 'ProgressRadar' });

export const HistoryQuery = SubjectScopeQuery.extend({
  days: z.coerce.number().int().min(1).max(30).default(30),
});

/** RF15: evolution of mastery over the last 30 days. */
export const ProgressHistory = z
  .object({
    points: z.array(
      z.object({
        date: DateOnly,
        average_mastery: Mastery.nullable().describe('Null on days before the first answer'),
        answer_count: z.int().min(0),
      }),
    ),
  })
  .meta({ id: 'ProgressHistory' });

/** RF16, EV9: „Recapitulare de azi”. */
export const ReviewQueue = z
  .object({
    due_count: z.int().min(0),
    items: z.array(
      z.object({
        concept_id: Id,
        subject_id: Id,
        name: z.string(),
        due_date: DateOnly,
        mastery: Mastery,
        status: MasteryStatusEnum,
      }),
    ),
  })
  .meta({ id: 'ReviewQueue' });

export const ReviewSessionQuery = SubjectScopeQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** One card of a review session. The answer is included: the student rates themself. */
export const ReviewItem = z
  .object({
    material_id: Id,
    concept_id: Id,
    concept_name: z.string(),
    type: MaterialTypeEnum,
    statement: z.string(),
    options: z.array(z.string()).length(4).nullable(),
    correct_answer: z.string().nullable(),
    explanation: z.string().nullable(),
    source: Source,
  })
  .meta({ id: 'ReviewItem' });

export const ReviewSession = z
  .object({ items: z.array(ReviewItem).describe('Due flashcards and questions, mixed') })
  .meta({ id: 'ReviewSession' });

export const ReviewAnswerRequest = z
  .object({
    material_id: Id,
    rating: z
      .enum(['forgot', 'hard', 'knew'])
      .describe('„Nu am știut” (q = 1), „Cu efort” (q = 3), „Am știut” (q = 5)'),
  })
  .meta({ id: 'ReviewAnswerRequest' });

export const ReviewAnswerResponse = z
  .object({
    concept_id: Id,
    mastery: Mastery,
    status: MasteryStatusEnum,
    interval_days: z.int().min(1),
    next_review_date: DateOnly,
    celebrate: z
      .boolean()
      .describe('True once when the concept crosses the upper threshold: show confetti (RF17)'),
  })
  .meta({ id: 'ReviewAnswerResponse' });
