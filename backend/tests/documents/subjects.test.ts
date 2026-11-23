import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/auth-app.js';
import { factories } from '../helpers/db.js';
import { buildDocumentsTestApp, createSubject, readyDocument } from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/** UC-04 „Gestionează materiile și documentele” — RF3 (subjects). Design: section 1. */
describe('subjects (UC-04, RF3)', () => {
  let ctx: DocumentsTestApp;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    user = await registerStudent(ctx.app);
  });
  afterAll(() => ctx.close());

  const api = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    who: TestUser,
    payload?: object,
  ) =>
    ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: who.headers,
      ...(payload ? { payload } : {}),
    });

  describe('creating', () => {
    it('answers 201 with the subject and zero counters', async () => {
      const response = await api('POST', '/subjects', user, { name: 'Baze de date' });
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        name: 'Baze de date',
        document_count: 0,
        concept_count: 0,
        due_concept_count: 0,
      });
      expect(body.id).toBeGreaterThan(0);
      expect(Math.abs(new Date(body.created_at).getTime() - Date.now())).toBeLessThan(10_000);
    });

    it('trims the name', async () => {
      const response = await api('POST', '/subjects', user, { name: '   Rețele   ' });
      expect(response.statusCode).toBe(201);
      expect(response.json().name).toBe('Rețele');
    });

    it.each([
      ['empty', ''],
      ['only spaces', '    '],
      ['101 characters', 'a'.repeat(101)],
    ])('refuses a name that is %s with 400', async (_case, name) => {
      const response = await api('POST', '/subjects', user, { name });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    });

    it('accepts a name of exactly 100 characters', async () => {
      const response = await api('POST', '/subjects', user, { name: 'b'.repeat(100) });
      expect(response.statusCode).toBe(201);
    });

    it('refuses a name the student already uses: 409 SUBJECT_NAME_TAKEN', async () => {
      await api('POST', '/subjects', user, { name: 'Algoritmi' });
      const response = await api('POST', '/subjects', user, { name: 'Algoritmi' });
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('SUBJECT_NAME_TAKEN');
    });

    it('treats names that differ only by case or surrounding spaces as the same (Q17)', async () => {
      await api('POST', '/subjects', user, { name: 'Sisteme de operare' });
      for (const name of ['sisteme de operare', 'SISTEME DE OPERARE', '  Sisteme de Operare ']) {
        const response = await api('POST', '/subjects', user, { name });
        expect(response.statusCode, name).toBe(409);
      }
    });

    it('lets another student use the same name', async () => {
      const other = await registerStudent(ctx.app);
      await api('POST', '/subjects', user, { name: 'Analiză matematică' });
      expect(
        (await api('POST', '/subjects', other, { name: 'Analiză matematică' })).statusCode,
      ).toBe(201);
    });
  });

  describe('reading and listing', () => {
    it('reads one subject', async () => {
      const id = await createSubject(ctx.app, user, 'Fizică');
      const response = await api('GET', `/subjects/${id}`, user);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id, name: 'Fizică' });
    });

    it('answers 404 for a subject that does not exist', async () => {
      expect((await api('GET', '/subjects/999999999', user)).statusCode).toBe(404);
    });

    it('lists only the student’s subjects, alphabetically without regard to case, paginated', async () => {
      const mine = await registerStudent(ctx.app);
      const other = await registerStudent(ctx.app);
      for (const name of ['zoologie', 'Algebră', 'chimie', 'Biologie']) {
        await createSubject(ctx.app, mine, name);
      }
      await createSubject(ctx.app, other, 'Materia altcuiva');

      const all = (await api('GET', '/subjects', mine)).json();
      expect(all).toMatchObject({ total: 4, page: 1, page_size: 20 });
      expect(all.items.map((s: { name: string }) => s.name)).toEqual([
        'Algebră',
        'Biologie',
        'chimie',
        'zoologie',
      ]);

      const second = (await api('GET', '/subjects?page=2&page_size=3', mine)).json();
      expect(second).toMatchObject({ total: 4, page: 2, page_size: 3 });
      expect(second.items.map((s: { name: string }) => s.name)).toEqual(['zoologie']);
    });

    it('counts documents without the deleted ones, concepts, and concepts due today', async () => {
      const student = await registerStudent(ctx.app);
      const subjectId = await createSubject(ctx.app, student);
      const kept = await readyDocument(ctx, student, subjectId);
      const removed = await readyDocument(ctx, student, subjectId);
      await api('DELETE', `/documents/${removed}`, student);

      const f = factories(ctx.pool);
      const due = await f.concept(subjectId, { name: 'Scadent' });
      const later = await f.concept(subjectId, { name: 'Mai târziu' });
      await f.concept(subjectId, { name: 'Fără recapitulare' });
      await f.insert('reviews', { user_id: student.id, concept_id: due, due_date: '2020-01-01' });
      await f.insert('reviews', { user_id: student.id, concept_id: later, due_date: '2999-01-01' });

      const subject = (await api('GET', `/subjects/${subjectId}`, student)).json();
      expect(subject).toMatchObject({ document_count: 1, concept_count: 3, due_concept_count: 1 });
      const listed = (await api('GET', '/subjects', student)).json().items[0];
      expect(listed).toMatchObject({ document_count: 1, concept_count: 3, due_concept_count: 1 });
      expect(kept).toBeGreaterThan(0);
    });
  });

  describe('renaming', () => {
    it('changes the name and nothing else', async () => {
      const id = await createSubject(ctx.app, user, 'Nume vechi');
      const response = await api('PATCH', `/subjects/${id}`, user, { name: '  Nume nou ' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id, name: 'Nume nou' });
      expect((await api('GET', `/subjects/${id}`, user)).json().name).toBe('Nume nou');
    });

    it('refuses the name of another subject of the same student, in any case', async () => {
      await createSubject(ctx.app, user, 'Ocupat');
      const id = await createSubject(ctx.app, user, 'De redenumit');
      const response = await api('PATCH', `/subjects/${id}`, user, { name: 'OCUPAT' });
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('SUBJECT_NAME_TAKEN');
    });

    it('accepts its own name again, also with other capitals', async () => {
      const id = await createSubject(ctx.app, user, 'Geometrie');
      expect((await api('PATCH', `/subjects/${id}`, user, { name: 'Geometrie' })).statusCode).toBe(
        200,
      );
      const recased = await api('PATCH', `/subjects/${id}`, user, { name: 'GEOMETRIE' });
      expect(recased.statusCode).toBe(200);
      expect(recased.json().name).toBe('GEOMETRIE');
    });

    it('answers 404 for a subject that does not exist and 400 for an invalid name', async () => {
      expect((await api('PATCH', '/subjects/999999999', user, { name: 'X' })).statusCode).toBe(404);
      const id = await createSubject(ctx.app, user);
      expect((await api('PATCH', `/subjects/${id}`, user, { name: ' ' })).statusCode).toBe(400);
    });
  });

  describe('deleting (M10 is confirmed by the interface)', () => {
    it('answers 204 and the subject is gone', async () => {
      const id = await createSubject(ctx.app, user);
      expect((await api('DELETE', `/subjects/${id}`, user)).statusCode).toBe(204);
      expect((await api('GET', `/subjects/${id}`, user)).statusCode).toBe(404);
      expect((await api('DELETE', `/subjects/${id}`, user)).statusCode).toBe(404);
    });

    it('removes its documents, passages, concepts, materials, tests, answers, progress and reviews (RF3)', async () => {
      const student = await registerStudent(ctx.app);
      const subjectId = await createSubject(ctx.app, student);
      const documentId = await readyDocument(ctx, student, subjectId);
      const f = factories(ctx.pool);
      const { rows } = await ctx.pool.query(
        'SELECT id FROM passages WHERE document_id = $1 LIMIT 1',
        [documentId],
      );
      const passageId = Number(rows[0].id);
      const conceptId = await f.concept(subjectId);
      await f.insert('concept_passages', { concept_id: conceptId, passage_id: passageId });
      const materialId = await f.material(conceptId, passageId);
      const testId = await f.test(student.id, subjectId);
      await f.insert('answers', {
        test_id: testId,
        material_id: materialId,
        given_answer: 'x',
        score: 1,
        quality: 5,
      });
      await f.insert('concept_progress', {
        user_id: student.id,
        concept_id: conceptId,
        mastery: 50,
        status: 'in_progress',
      });
      await f.insert('reviews', {
        user_id: student.id,
        concept_id: conceptId,
        due_date: '2026-11-20',
      });

      expect((await api('DELETE', `/subjects/${subjectId}`, student)).statusCode).toBe(204);

      const left = async (sql: string, id: number) =>
        (await ctx.pool.query(`SELECT count(*)::int AS n FROM ${sql}`, [id])).rows[0].n as number;
      expect(await left('subjects WHERE id = $1', subjectId)).toBe(0);
      expect(await left('documents WHERE subject_id = $1', subjectId)).toBe(0);
      expect(await left('passages WHERE document_id = $1', documentId)).toBe(0);
      expect(await left('sentences WHERE document_id = $1', documentId)).toBe(0);
      expect(await left('concepts WHERE subject_id = $1', subjectId)).toBe(0);
      expect(await left('materials WHERE concept_id = $1', conceptId)).toBe(0);
      expect(await left('tests WHERE subject_id = $1', subjectId)).toBe(0);
      expect(await left('answers WHERE material_id = $1', materialId)).toBe(0);
      expect(await left('concept_progress WHERE concept_id = $1', conceptId)).toBe(0);
      expect(await left('reviews WHERE concept_id = $1', conceptId)).toBe(0);
    });

    it('leaves the other subjects of the student alone', async () => {
      const student = await registerStudent(ctx.app);
      const doomed = await createSubject(ctx.app, student);
      const kept = await createSubject(ctx.app, student);
      const documentId = await readyDocument(ctx, student, kept);
      await api('DELETE', `/subjects/${doomed}`, student);
      expect((await api('GET', `/subjects/${kept}`, student)).json().document_count).toBe(1);
      expect((await api('GET', `/documents/${documentId}`, student)).statusCode).toBe(200);
    });
  });

  describe('access', () => {
    it('needs a session', async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/subjects' });
      expect(response.statusCode).toBe(401);
    });

    it('another student gets 404 for reading, renaming and deleting, and nothing changes', async () => {
      const other = await registerStudent(ctx.app);
      const id = await createSubject(ctx.app, user, 'Numai a mea');
      expect((await api('GET', `/subjects/${id}`, other)).statusCode).toBe(404);
      expect((await api('PATCH', `/subjects/${id}`, other, { name: 'Furată' })).statusCode).toBe(
        404,
      );
      expect((await api('DELETE', `/subjects/${id}`, other)).statusCode).toBe(404);
      expect((await api('GET', `/subjects/${id}`, user)).json().name).toBe('Numai a mea');
    });
  });
});
