import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { TABLES, count, createTestPool, factories, seedGraph, truncateAll } from './helpers/db.js';

const pool = createTestPool();
const f = factories(pool);

/** Asserts that PostgreSQL rejects the statement because of the named constraint. */
async function expectViolation(action: Promise<unknown>, constraint: string): Promise<void> {
  await expect(action).rejects.toMatchObject({ constraint });
}

describe('database constraints', () => {
  beforeEach(() => truncateAll(pool));
  afterAll(() => pool.end());

  describe('users, preferences, reset tokens', () => {
    it('e-mail is unique, ignoring case (RF1)', async () => {
      await f.user({ email: 'Ana@Example.com' });
      await expectViolation(f.user({ email: 'ana@example.com' }), 'users_email_lower_key');
    });

    it('role and status accept only the documented values', async () => {
      await expectViolation(f.user({ role: 'visitor' }), 'users_role_check');
      await expectViolation(f.user({ status: 'temporarily_locked' }), 'users_status_check');
    });

    it('defaults: role student, status active, no failed attempts', async () => {
      const id = await f.user();
      const { rows } = await pool.query(
        'SELECT role, status, failed_login_attempts FROM users WHERE id = $1',
        [id],
      );
      expect(rows[0]).toEqual({ role: 'student', status: 'active', failed_login_attempts: 0 });
    });

    it('preferences: one row per user, daily goal 5–100 (RF18)', async () => {
      const userId = await f.user();
      await f.insert('preferences', { user_id: userId });
      await expectViolation(f.insert('preferences', { user_id: userId }), 'preferences_pkey');
      const other = await f.user();
      await expectViolation(
        f.insert('preferences', { user_id: other, daily_goal: 4 }),
        'preferences_daily_goal_check',
      );
      await expectViolation(
        f.insert('preferences', { user_id: other, daily_goal: 101 }),
        'preferences_daily_goal_check',
      );
      await expectViolation(
        f.insert('preferences', { user_id: other, theme: 'blue' }),
        'preferences_theme_check',
      );
      await expectViolation(
        f.insert('preferences', { user_id: other, reminder_channel: 'sms' }),
        'preferences_reminder_channel_check',
      );
    });

    it('reset token hashes are unique (C-24)', async () => {
      const userId = await f.user();
      const token = {
        user_id: userId,
        token_hash: 'abc',
        expires_at: new Date(Date.now() + 3_600_000),
      };
      await f.insert('password_reset_tokens', token);
      await expectViolation(
        f.insert('password_reset_tokens', token),
        'password_reset_tokens_token_hash_key',
      );
    });
  });

  describe('subjects, documents, passages', () => {
    it('subject name is unique per student, not globally (RF3)', async () => {
      const ana = await f.user();
      const ion = await f.user();
      await f.subject(ana, { name: 'Baze de date' });
      await f.subject(ion, { name: 'Baze de date' });
      await expectViolation(f.subject(ana, { name: 'Baze de date' }), 'subjects_user_id_name_key');
    });

    it('subject name cannot be blank', async () => {
      await expectViolation(f.subject(await f.user(), { name: '   ' }), 'subjects_name_check');
    });

    it('document format is PDF, DOCX or TXT only (PPTX is out of contract)', async () => {
      const subjectId = await f.subject(await f.user());
      await expectViolation(f.document(subjectId, { format: 'pptx' }), 'documents_format_check');
    });

    it('document size and page count must be positive', async () => {
      const subjectId = await f.subject(await f.user());
      await expectViolation(f.document(subjectId, { size_bytes: 0 }), 'documents_size_bytes_check');
      await expectViolation(f.document(subjectId, { page_count: 0 }), 'documents_page_count_check');
    });

    it('passage order is unique inside a document and offsets are ordered', async () => {
      const documentId = await f.document(await f.subject(await f.user()));
      await f.passage(documentId, { position: 0 });
      await expectViolation(
        f.passage(documentId, { position: 0 }),
        'passages_document_id_position_key',
      );
      await expectViolation(
        f.passage(documentId, { start_offset: 10, end_offset: 10 }),
        'passages_offsets_check',
      );
      await expectViolation(f.passage(documentId, { page: 0 }), 'passages_page_check');
    });
  });

  describe('concepts and materials', () => {
    async function setup() {
      const userId = await f.user();
      const subjectId = await f.subject(userId);
      const passageId = await f.passage(await f.document(subjectId));
      const conceptId = await f.concept(subjectId);
      return { userId, subjectId, passageId, conceptId };
    }

    it('concept origin is model or manual; the pair concept–passage is unique', async () => {
      const { subjectId, passageId, conceptId } = await setup();
      await expectViolation(f.concept(subjectId, { origin: 'import' }), 'concepts_origin_check');
      await f.insert('concept_passages', { concept_id: conceptId, passage_id: passageId });
      await expectViolation(
        f.insert('concept_passages', { concept_id: conceptId, passage_id: passageId }),
        'concept_passages_concept_id_passage_id_pk',
      );
    });

    it('a material needs a concept and a source passage (RF10)', async () => {
      const { passageId, conceptId } = await setup();
      await expect(f.material(conceptId, passageId, { passage_id: null })).rejects.toMatchObject({
        code: '23502',
      });
      await expect(f.material(conceptId, passageId, { concept_id: null })).rejects.toMatchObject({
        code: '23502',
      });
    });

    it('a valid material must have a verified source (RB1)', async () => {
      const { passageId, conceptId } = await setup();
      await expectViolation(
        f.material(conceptId, passageId, { source_verified: false }),
        'materials_valid_requires_verified_source_check',
      );
      await f.material(conceptId, passageId, { source_verified: false, status: 'removed' });
    });

    it('accepts the five material types and nothing else', async () => {
      const { passageId, conceptId } = await setup();
      await f.material(conceptId, passageId, { type: 'summary', correct_answer: null });
      await f.material(conceptId, passageId, { type: 'open' });
      await f.material(conceptId, passageId, { type: 'true_false', correct_answer: 'true' });
      await expectViolation(
        f.material(conceptId, passageId, { type: 'essay' }),
        'materials_type_check',
      );
    });

    it('a multiple-choice question has exactly 4 options; other types have none (RF12)', async () => {
      const { passageId, conceptId } = await setup();
      const mc = { type: 'multiple_choice', correct_answer: 'a' };
      await f.material(conceptId, passageId, {
        ...mc,
        options: JSON.stringify(['a', 'b', 'c', 'd']),
      });
      await expectViolation(
        f.material(conceptId, passageId, { ...mc, options: JSON.stringify(['a', 'b', 'c']) }),
        'materials_options_check',
      );
      await expectViolation(f.material(conceptId, passageId, mc), 'materials_options_check');
      await expectViolation(
        f.material(conceptId, passageId, { options: JSON.stringify(['a', 'b', 'c', 'd']) }),
        'materials_options_check',
      );
    });

    it('only a summary may lack a correct answer', async () => {
      const { passageId, conceptId } = await setup();
      await expectViolation(
        f.material(conceptId, passageId, { correct_answer: null }),
        'materials_correct_answer_check',
      );
    });

    it('a student reports a material only once; the reason is 1–300 characters (C-19)', async () => {
      const { userId, passageId, conceptId } = await setup();
      const materialId = await f.material(conceptId, passageId);
      const report = { material_id: materialId, user_id: userId, reason: 'greșit' };
      await f.insert('material_reports', report);
      await expectViolation(
        f.insert('material_reports', report),
        'material_reports_material_id_user_id_key',
      );
      const other = await f.user();
      await f.insert('material_reports', { ...report, user_id: other });
      const third = await f.user();
      await expectViolation(
        f.insert('material_reports', { ...report, user_id: third, reason: ' ' }),
        'material_reports_reason_check',
      );
      await expect(
        f.insert('material_reports', { ...report, user_id: third, reason: 'x'.repeat(301) }),
      ).rejects.toMatchObject({ code: '22001' });
    });
  });

  describe('tests, answers, mastery, reviews', () => {
    async function setup() {
      const graph = await seedGraph(pool);
      return graph;
    }

    it('answer score is 0, 0.5, 1 or NULL (unevaluated, C-04); quality is 1–5', async () => {
      const { materialId } = await setup();
      const answer = { material_id: materialId, given_answer: 'x' };
      await f.insert('answers', { ...answer, score: null, quality: null });
      await expectViolation(f.insert('answers', { ...answer, score: 0.7 }), 'answers_score_check');
      await expectViolation(
        f.insert('answers', { ...answer, quality: 0 }),
        'answers_quality_check',
      );
      await expectViolation(
        f.insert('answers', { ...answer, quality: 6 }),
        'answers_quality_check',
      );
    });

    it('a question is answered once per test, any number of times in reviews', async () => {
      const { materialId, testId } = await setup();
      await expectViolation(
        f.insert('answers', { test_id: testId, material_id: materialId, given_answer: 'again' }),
        'answers_test_id_material_id_key',
      );
      await f.insert('answers', { material_id: materialId, given_answer: 'review' });
    });

    it('test score is 0–100 and exists only for a finished test (C-05)', async () => {
      const { userId, subjectId } = await setup();
      await expectViolation(
        f.test(userId, subjectId, { total_score: 50 }),
        'tests_score_requires_finish_check',
      );
      await expectViolation(
        f.test(userId, subjectId, { total_score: 101, finished_at: new Date(Date.now() + 1000) }),
        'tests_total_score_check',
      );
    });

    it('mastery S stays between 0 and 100; one row per student and concept', async () => {
      const { userId, conceptId } = await setup();
      await expectViolation(
        pool.query('UPDATE concept_progress SET mastery = 101'),
        'concept_progress_mastery_check',
      );
      await expectViolation(
        pool.query('UPDATE concept_progress SET mastery = -1'),
        'concept_progress_mastery_check',
      );
      await expectViolation(
        pool.query(`UPDATE concept_progress SET status = 'expert'`),
        'concept_progress_status_check',
      );
      await expectViolation(
        f.insert('concept_progress', { user_id: userId, concept_id: conceptId }),
        'concept_progress_user_id_concept_id_pk',
      );
    });

    it('ease factor never drops below 1.3 and starts at 2.5 (RB3)', async () => {
      const { userId, conceptId } = await setup();
      const { rows } = await pool.query('SELECT ease_factor, repetitions FROM reviews');
      expect(Number(rows[0].ease_factor)).toBe(2.5);
      expect(rows[0].repetitions).toBe(0);
      await pool.query('UPDATE reviews SET ease_factor = 1.3');
      await expectViolation(
        pool.query('UPDATE reviews SET ease_factor = 1.29'),
        'reviews_ease_factor_check',
      );
      await expectViolation(
        f.insert('reviews', { user_id: userId, concept_id: conceptId, due_date: '2026-12-01' }),
        'reviews_user_id_concept_id_pk',
      );
    });
  });

  describe('model call journal', () => {
    it('an error code is present exactly when the call failed (C-06)', async () => {
      const call = { operation: 'generate_materials', duration_ms: 10 };
      await f.insert('llm_calls', {
        ...call,
        status: 'timeout',
        error_code: 'TIMEOUT',
        attempt: 2,
      });
      await expectViolation(
        f.insert('llm_calls', { ...call, status: 'timeout' }),
        'llm_calls_error_code_check',
      );
      await expectViolation(
        f.insert('llm_calls', { ...call, status: 'success', error_code: 'X' }),
        'llm_calls_error_code_check',
      );
      await expectViolation(
        f.insert('llm_calls', { ...call, status: 'success', attempt: 4 }),
        'llm_calls_attempt_check',
      );
      await expectViolation(
        f.insert('llm_calls', { ...call, operation: 'chat', status: 'success' }),
        'llm_calls_operation_check',
      );
      await expectViolation(
        f.insert('llm_calls', { ...call, status: 'success', items_received: 1, items_accepted: 2 }),
        'llm_calls_items_check',
      );
    });
  });

  describe('deletion rules', () => {
    it('deleting a subject removes documents, passages, concepts, materials, tests, answers, progress and reviews (RF3)', async () => {
      const { subjectId } = await seedGraph(pool);
      await pool.query('DELETE FROM subjects WHERE id = $1', [subjectId]);
      for (const table of [
        'documents',
        'passages',
        'concepts',
        'concept_passages',
        'materials',
        'tests',
        'answers',
        'concept_progress',
        'reviews',
        'material_reports',
      ]) {
        expect(await count(pool, table), table).toBe(0);
      }
      expect(await count(pool, 'users')).toBe(1);
    });

    it('deleting an account removes all its data but keeps the model journal, unlinked (RF20, C-20)', async () => {
      const kept = await seedGraph(pool);
      const deleted = await seedGraph(pool);
      await pool.query('DELETE FROM users WHERE id = $1', [deleted.userId]);

      for (const table of TABLES) {
        if (table === 'llm_calls' || table === 'settings') continue;
        expect(await count(pool, table), table).toBe(table === 'answers' ? 2 : 1);
      }
      const { rows } = await pool.query('SELECT user_id, document_id FROM llm_calls ORDER BY id');
      expect(rows).toEqual([
        { user_id: String(kept.userId), document_id: String(kept.documentId) },
        { user_id: null, document_id: null },
      ]);
    });

    it('deleting the passages of a document removes the materials that cite them', async () => {
      const { documentId } = await seedGraph(pool);
      await pool.query('DELETE FROM passages WHERE document_id = $1', [documentId]);
      expect(await count(pool, 'materials')).toBe(0);
      expect(await count(pool, 'concept_passages')).toBe(0);
      expect(await count(pool, 'concepts')).toBe(1);
    });
  });
});
