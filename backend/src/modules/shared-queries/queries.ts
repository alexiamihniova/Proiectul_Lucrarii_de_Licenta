import { and, eq, inArray, sql } from 'drizzle-orm';
import type { UserActor } from '../../core/actor.js';
import type { Database } from '../../db/client.js';
import {
  answers,
  conceptProgress,
  concepts,
  materials,
  reviews,
  subjects,
  tests,
} from '../../db/schema/index.js';

/**
 * Read-only queries that cross module boundaries (ADR-0014, Q50). This is the ONLY place outside
 * a module's own `repository.ts` that queries tables of other modules, and the only folder the
 * ESLint rule on `db/schema` imports does not cover.
 *
 * Rules for every function here:
 *  - read only;
 *  - the first parameter is a `UserActor`, and every query filters by `actor.userId`, directly
 *    or through the subject that owns the row;
 *  - the columns are listed, never `SELECT *`;
 *  - no document text and no generated material leaves through here unless a route needs it.
 *
 * When the module that owns the data gets a service that can answer, the function moves there
 * and disappears from this file (Q45: the export, at Segment 5).
 */

// --- data export (RF20) ---------------------------------------------------------------------

/** The data sets of the export and their columns, in the order they appear in the CSV files. */
export const STUDY_DATA_COLUMNS = {
  subjects: ['id', 'name', 'created_at'],
  concepts: ['id', 'subject_id', 'name', 'definition', 'origin', 'created_at'],
  tests: ['id', 'subject_id', 'started_at', 'finished_at', 'total_score'],
  answers: ['id', 'test_id', 'material_id', 'given_answer', 'score', 'quality', 'answered_at'],
  progress: ['concept_id', 'mastery', 'status', 'updated_at'],
} as const;

export type StudyData = Record<keyof typeof STUDY_DATA_COLUMNS, Record<string, unknown>[]>;

/**
 * The study data of ONE user, for the export of RF20: subjects, concepts, results, progress.
 * An answer has no direct link to a user (Q24), so answers are reached through the subject that
 * owns their material.
 */
export async function readStudyData(actor: UserActor, db: Database): Promise<StudyData> {
  const orm = db.orm;
  const owned = eq(subjects.userId, actor.userId);

  const [subjectRows, conceptRows, testRows, answerRows, progressRows] = await Promise.all([
    orm
      .select({ id: subjects.id, name: subjects.name, created_at: subjects.createdAt })
      .from(subjects)
      .where(owned)
      .orderBy(subjects.id),
    orm
      .select({
        id: concepts.id,
        subject_id: concepts.subjectId,
        name: concepts.name,
        definition: concepts.definition,
        origin: concepts.origin,
        created_at: concepts.createdAt,
      })
      .from(concepts)
      .innerJoin(subjects, eq(subjects.id, concepts.subjectId))
      .where(owned)
      .orderBy(concepts.id),
    orm
      .select({
        id: tests.id,
        subject_id: tests.subjectId,
        started_at: tests.startedAt,
        finished_at: tests.finishedAt,
        total_score: tests.totalScore,
      })
      .from(tests)
      .where(eq(tests.userId, actor.userId))
      .orderBy(tests.id),
    orm
      .select({
        id: answers.id,
        test_id: answers.testId,
        material_id: answers.materialId,
        given_answer: answers.givenAnswer,
        score: answers.score,
        quality: answers.quality,
        answered_at: answers.answeredAt,
      })
      .from(answers)
      .innerJoin(materials, eq(materials.id, answers.materialId))
      .innerJoin(concepts, eq(concepts.id, materials.conceptId))
      .innerJoin(subjects, eq(subjects.id, concepts.subjectId))
      .where(owned)
      .orderBy(answers.id),
    orm
      .select({
        concept_id: conceptProgress.conceptId,
        mastery: conceptProgress.mastery,
        status: conceptProgress.status,
        updated_at: conceptProgress.updatedAt,
      })
      .from(conceptProgress)
      .where(eq(conceptProgress.userId, actor.userId))
      .orderBy(conceptProgress.conceptId),
  ]);

  return {
    subjects: subjectRows,
    concepts: conceptRows,
    tests: testRows,
    answers: answerRows,
    progress: progressRows,
  };
}

// --- counters of a subject (UC-04, Q50) ------------------------------------------------------

export interface SubjectConceptCounts {
  /** Concepts of the subject. */
  concepts: number;
  /** Concepts with a review due today or earlier, in the application's time zone (RF16). */
  dueConcepts: number;
}

/**
 * `concept_count` and `due_concept_count` of the given subjects, for the list of subjects.
 * One query for the whole list, not one per row. A subject that is not the actor's is not
 * counted: it answers zero, like a subject without concepts.
 */
export async function countSubjectConcepts(
  actor: UserActor,
  db: Database,
  subjectIds: number[],
  timeZone: string,
): Promise<Map<number, SubjectConceptCounts>> {
  const counts = new Map<number, SubjectConceptCounts>();
  if (subjectIds.length === 0) return counts;
  const rows = await db.orm
    .select({
      subjectId: concepts.subjectId,
      concepts: sql<number>`count(*)::int`,
      dueConcepts: sql<number>`count(*) filter (where ${reviews.dueDate} <= (now() at time zone ${timeZone})::date)::int`,
    })
    .from(concepts)
    .innerJoin(subjects, eq(subjects.id, concepts.subjectId))
    .leftJoin(reviews, and(eq(reviews.conceptId, concepts.id), eq(reviews.userId, actor.userId)))
    .where(and(eq(subjects.userId, actor.userId), inArray(concepts.subjectId, subjectIds)))
    .groupBy(concepts.subjectId);
  for (const row of rows) {
    counts.set(row.subjectId, { concepts: row.concepts, dueConcepts: row.dueConcepts });
  }
  return counts;
}
