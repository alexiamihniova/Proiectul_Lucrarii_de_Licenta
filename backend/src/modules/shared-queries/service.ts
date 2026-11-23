/**
 * Public surface of the shared-queries module (ADR-0014, Q50): read-only queries that cross
 * module boundaries. Other modules import ONLY from this file. See `queries.ts` for the rules.
 */
export { STUDY_DATA_COLUMNS, countSubjectConcepts, readStudyData } from './queries.js';
export type { StudyData, SubjectConceptCounts } from './queries.js';
