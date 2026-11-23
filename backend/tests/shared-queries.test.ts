import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actorFromUser } from '../src/core/actor.js';
import { createDatabase } from '../src/db/client.js';
import type { Database } from '../src/db/client.js';
import {
  STUDY_DATA_COLUMNS,
  countSubjectConcepts,
  readStudyData,
} from '../src/modules/shared-queries/service.js';
import { createTestPool, factories, seedOwnedData } from './helpers/db.js';
import { testConfig } from './helpers/env.js';

/**
 * ADR-0014, Q50: the one place for read queries across modules. Every function must answer
 * with the actor's own data and nothing of anyone else's.
 */
describe('shared-queries (ADR-0014)', () => {
  const config = testConfig();
  let db: Database;
  let pool: pg.Pool;
  let mine: Awaited<ReturnType<typeof seedOwnedData>>;
  let theirs: Awaited<ReturnType<typeof seedOwnedData>>;
  const actor = (userId: number) => actorFromUser({ id: userId, role: 'student' });

  beforeAll(async () => {
    db = createDatabase({ url: config.database.url, poolMax: 2 });
    pool = createTestPool();
    const f = factories(pool);
    mine = await seedOwnedData(pool, await f.user());
    theirs = await seedOwnedData(pool, await f.user());
  });
  afterAll(async () => {
    await db.close();
    await pool.end();
  });

  describe('readStudyData (the export, RF20)', () => {
    it('returns the data sets of the actor, each with the columns listed for the CSV files', async () => {
      const data = await readStudyData(actor(mine.userId), db);
      expect(Object.keys(data)).toEqual(Object.keys(STUDY_DATA_COLUMNS));
      expect(data.subjects.map((row) => Number(row.id))).toEqual([mine.subjectId]);
      expect(data.concepts.map((row) => Number(row.id))).toEqual([mine.conceptId]);
      expect(data.tests.map((row) => Number(row.id))).toEqual([mine.testId]);
      expect(data.answers).toHaveLength(2);
      expect(data.progress.map((row) => Number(row.concept_id))).toEqual([mine.conceptId]);
      for (const [set, columns] of Object.entries(STUDY_DATA_COLUMNS)) {
        const rows = data[set as keyof typeof data];
        for (const row of rows) expect(Object.keys(row)).toEqual([...columns]);
      }
    });

    it('returns nothing of another student', async () => {
      const data = await readStudyData(actor(mine.userId), db);
      const everyId = JSON.stringify(data);
      expect(data.subjects.map((row) => Number(row.id))).not.toContain(theirs.subjectId);
      expect(data.concepts.map((row) => Number(row.id))).not.toContain(theirs.conceptId);
      expect(data.tests.map((row) => Number(row.id))).not.toContain(theirs.testId);
      expect(everyId).not.toContain('"password');
    });

    it('returns empty lists for a student with no data', async () => {
      const empty = await factories(pool).user();
      const data = await readStudyData(actor(empty), db);
      for (const rows of Object.values(data)) expect(rows).toEqual([]);
    });
  });

  describe('countSubjectConcepts (the counters of a subject, UC-04)', () => {
    it('counts the concepts of a subject and those with a review due today or earlier', async () => {
      const f = factories(pool);
      const user = await f.user();
      const subjectId = await f.subject(user);
      const due = await f.concept(subjectId, { name: 'Scadent' });
      const later = await f.concept(subjectId, { name: 'Mai târziu' });
      await f.concept(subjectId, { name: 'Fără recapitulare' });
      await f.insert('reviews', { user_id: user, concept_id: due, due_date: '2020-01-01' });
      await f.insert('reviews', { user_id: user, concept_id: later, due_date: '2999-01-01' });

      const counts = await countSubjectConcepts(actor(user), db, [subjectId], config.timezone);
      expect(counts.get(subjectId)).toEqual({ concepts: 3, dueConcepts: 1 });
    });

    it('answers for several subjects at once and leaves out the ones without concepts', async () => {
      const f = factories(pool);
      const user = await f.user();
      const a = await f.subject(user);
      const b = await f.subject(user);
      await f.concept(a, { name: 'Unu' });
      const counts = await countSubjectConcepts(actor(user), db, [a, b], config.timezone);
      expect(counts.get(a)).toEqual({ concepts: 1, dueConcepts: 0 });
      expect(counts.has(b)).toBe(false);
    });

    it('does not count the concepts of a subject that is not the actor’s', async () => {
      const counts = await countSubjectConcepts(
        actor(mine.userId),
        db,
        [theirs.subjectId],
        config.timezone,
      );
      expect(counts.size).toBe(0);
    });

    it('does not count another student’s review as the actor’s', async () => {
      const f = factories(pool);
      const owner = await f.user();
      const stranger = await f.user();
      const subjectId = await f.subject(owner);
      const concept = await f.concept(subjectId);
      await f.insert('reviews', { user_id: stranger, concept_id: concept, due_date: '2020-01-01' });
      const counts = await countSubjectConcepts(actor(owner), db, [subjectId], config.timezone);
      expect(counts.get(subjectId)).toEqual({ concepts: 1, dueConcepts: 0 });
    });

    it('answers an empty map for no subjects', async () => {
      expect((await countSubjectConcepts(actor(mine.userId), db, [], config.timezone)).size).toBe(
        0,
      );
    });
  });
});
