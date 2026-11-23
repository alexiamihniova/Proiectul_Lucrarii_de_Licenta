import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/auth-app.js';
import { factories } from '../helpers/db.js';
import {
  SAMPLE_TEXT,
  buildDocumentsTestApp,
  createSubject,
  documentRow,
  processQueue,
  readyDocument,
  upload,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { asciiProse, docx, pdf, txt, wrap } from '../helpers/fixtures.js';
import { registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/** UC-04 — RF6 (list, rename, delete), RF5 (original file). Design: sections 5 and 6. */
describe('documents (UC-04, RF5, RF6)', () => {
  let ctx: DocumentsTestApp;
  let user: TestUser;
  let subjectId: number;

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    user = await registerStudent(ctx.app);
    subjectId = await createSubject(ctx.app, user);
  });
  afterAll(() => ctx.close());

  const api = (
    method: 'GET' | 'PATCH' | 'DELETE',
    url: string,
    who: TestUser = user,
    payload?: object,
  ) =>
    ctx.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: who.headers,
      ...(payload ? { payload } : {}),
    });

  describe('listing (RF6)', () => {
    let student: TestUser;
    let first: number;
    let second: number;
    let ids: number[];

    beforeAll(async () => {
      student = await registerStudent(ctx.app);
      first = await createSubject(ctx.app, student);
      second = await createSubject(ctx.app, student);
      const ready = await readyDocument(ctx, student, first, {
        fileName: 'a.txt',
        content: txt(SAMPLE_TEXT),
      });
      const failed = await readyDocument(ctx, student, first, {
        fileName: 'b.txt',
        content: txt('scurt'),
      });
      const queued = await upload(ctx.app, student, second, {
        fileName: 'c.txt',
        content: txt(SAMPLE_TEXT),
      });
      const deleted = await upload(ctx.app, student, second, {
        fileName: 'd.txt',
        content: txt(SAMPLE_TEXT),
      });
      await api('DELETE', `/documents/${deleted}`, student);
      ids = [ready, failed, queued];
      // Make the upload order unambiguous.
      for (const [index, id] of ids.entries()) {
        await ctx.pool.query(
          `UPDATE documents SET uploaded_at = now() - ($2 || ' minutes')::interval WHERE id = $1`,
          [id, String(10 - index)],
        );
      }
    });

    it('returns name, subject, upload date, page count and state, newest first, without deleted ones', async () => {
      const body = (await api('GET', '/documents', student)).json();
      expect(body).toMatchObject({ total: 3, page: 1, page_size: 20 });
      expect(body.items.map((d: { id: number }) => d.id)).toEqual([...ids].reverse());
      expect(body.items.map((d: { file_name: string }) => d.file_name)).toEqual([
        'c.txt',
        'b.txt',
        'a.txt',
      ]);
      const ready = body.items[2];
      expect(ready).toMatchObject({
        subject_id: first,
        status: 'ready',
        format: 'txt',
        error: null,
      });
      expect(ready.page_count).toBeGreaterThanOrEqual(1);
      expect(typeof ready.uploaded_at).toBe('string');
    });

    it('filters by subject and by state', async () => {
      const bySubject = (await api('GET', `/documents?subject_id=${second}`, student)).json();
      expect(bySubject.items.map((d: { file_name: string }) => d.file_name)).toEqual(['c.txt']);
      const byStatus = (await api('GET', '/documents?status=error', student)).json();
      expect(byStatus.items.map((d: { file_name: string }) => d.file_name)).toEqual(['b.txt']);
      expect(byStatus.items[0].error.code).toBe('TEXT_NOT_EXTRACTABLE');
      const both = (
        await api('GET', `/documents?subject_id=${first}&status=queued`, student)
      ).json();
      expect(both).toMatchObject({ total: 0, items: [] });
    });

    it('paginates', async () => {
      const body = (await api('GET', '/documents?page=2&page_size=2', student)).json();
      expect(body).toMatchObject({ total: 3, page: 2, page_size: 2 });
      expect(body.items.map((d: { file_name: string }) => d.file_name)).toEqual(['a.txt']);
    });

    it('"deleted" is not a state one can ask for', async () => {
      expect((await api('GET', '/documents?status=deleted', student)).statusCode).toBe(400);
    });

    it('shows nothing of another student and answers 404 for their subject as a filter', async () => {
      const other = await registerStudent(ctx.app);
      expect((await api('GET', '/documents', other)).json()).toMatchObject({ total: 0, items: [] });
      expect((await api('GET', `/documents?subject_id=${first}`, other)).statusCode).toBe(404);
    });
  });

  describe('renaming (event RD)', () => {
    it('changes the name, trimmed, and nothing else', async () => {
      const id = await readyDocument(ctx, user, subjectId);
      const before = await documentRow(ctx.pool, id);
      const response = await api('PATCH', `/documents/${id}`, user, {
        file_name: '  Curs 1 – Introducere  ',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id,
        file_name: 'Curs 1 – Introducere',
        status: 'ready',
        format: 'txt',
      });
      expect(await documentRow(ctx.pool, id)).toMatchObject({
        ...before,
        file_name: 'Curs 1 – Introducere',
      });
    });

    it('is allowed in every state and does not change the state', async () => {
      const queued = await upload(ctx.app, user, subjectId);
      expect(
        (await api('PATCH', `/documents/${queued}`, user, { file_name: 'în coadă' })).json().status,
      ).toBe('queued');

      ctx.analysis.hang();
      const running = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();
      expect(
        (await api('PATCH', `/documents/${queued}`, user, { file_name: 'în analiză' })).json()
          .status,
      ).toBe('processing');
      ctx.analysis.release();
      await running;

      const failed = await readyDocument(ctx, user, subjectId, {
        fileName: 'x.txt',
        content: txt('scurt'),
      });
      const renamed = (
        await api('PATCH', `/documents/${failed}`, user, { file_name: 'cu eroare' })
      ).json();
      expect(renamed).toMatchObject({ status: 'error', file_name: 'cu eroare' });
      expect(renamed.error.code).toBe('TEXT_NOT_EXTRACTABLE');
    });

    it('the format stays the one of the file, whatever extension the new name has', async () => {
      const id = await upload(ctx.app, user, subjectId);
      const response = await api('PATCH', `/documents/${id}`, user, { file_name: 'altceva.pdf' });
      expect(response.json()).toMatchObject({ file_name: 'altceva.pdf', format: 'txt' });
    });

    it.each([
      ['empty', ''],
      ['only spaces', '   '],
      ['256 characters', 'n'.repeat(256)],
    ])('refuses a name that is %s with 400', async (_case, name) => {
      const id = await upload(ctx.app, user, subjectId);
      const response = await api('PATCH', `/documents/${id}`, user, { file_name: name });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('deleting (event ȘT; M10 is confirmed by the interface)', () => {
    it('answers 204; the document is then unknown to every route', async () => {
      const id = await readyDocument(ctx, user, subjectId);
      expect((await api('DELETE', `/documents/${id}`)).statusCode).toBe(204);
      expect((await api('GET', `/documents/${id}`)).statusCode).toBe(404);
      expect((await api('PATCH', `/documents/${id}`, user, { file_name: 'x' })).statusCode).toBe(
        404,
      );
      expect((await api('DELETE', `/documents/${id}`)).statusCode).toBe(404);
      expect((await api('GET', `/documents/${id}/file`)).statusCode).toBe(404);
      expect((await api('GET', `/documents/${id}/passages`)).statusCode).toBe(404);
      const listed = (await api('GET', '/documents?page_size=100')).json().items;
      expect(listed.map((d: { id: number }) => d.id)).not.toContain(id);
    });

    it('is a soft delete: the row stays, marked deleted, for the daily counter (ADR-0008)', async () => {
      const id = await readyDocument(ctx, user, subjectId);
      await api('DELETE', `/documents/${id}`);
      const row = await documentRow(ctx.pool, id);
      expect(row).toMatchObject({ status: 'deleted' });
      expect(Math.abs(row!.deleted_at!.getTime() - Date.now())).toBeLessThan(10_000);
    });

    it('removes the passages, the sentences and what hangs off them, but not the concepts (Q51)', async () => {
      const id = await readyDocument(ctx, user, subjectId);
      const f = factories(ctx.pool);
      const passageId = Number(
        (await ctx.pool.query('SELECT id FROM passages WHERE document_id = $1 LIMIT 1', [id]))
          .rows[0].id,
      );
      const conceptId = await f.concept(subjectId, { name: `Concept ${id}` });
      await f.insert('concept_passages', { concept_id: conceptId, passage_id: passageId });
      const materialId = await f.material(conceptId, passageId);

      await api('DELETE', `/documents/${id}`);

      const left = async (sql: string, value: number) =>
        (await ctx.pool.query(`SELECT count(*)::int AS n FROM ${sql}`, [value])).rows[0]
          .n as number;
      expect(await left('passages WHERE document_id = $1', id)).toBe(0);
      expect(await left('sentences WHERE document_id = $1', id)).toBe(0);
      expect(await left('concept_passages WHERE passage_id = $1', passageId)).toBe(0);
      expect(await left('materials WHERE id = $1', materialId)).toBe(0);
      expect(await left('concepts WHERE id = $1', conceptId)).toBe(1);
    });

    it('is allowed in every state', async () => {
      const queued = await upload(ctx.app, user, subjectId);
      expect((await api('DELETE', `/documents/${queued}`)).statusCode).toBe(204);
      const failed = await readyDocument(ctx, user, subjectId, {
        fileName: 'x.txt',
        content: txt('scurt'),
      });
      expect((await api('DELETE', `/documents/${failed}`)).statusCode).toBe(204);
      await processQueue(ctx.app);
    });

    it('does not touch the other documents of the subject', async () => {
      const kept = await readyDocument(ctx, user, subjectId);
      const removed = await readyDocument(ctx, user, subjectId);
      await api('DELETE', `/documents/${removed}`);
      expect((await api('GET', `/documents/${kept}`)).json().status).toBe('ready');
      expect((await api('GET', `/documents/${kept}/passages`)).json().total).toBeGreaterThan(0);
    });
  });

  describe('the original file (RF5)', () => {
    it.each([
      ['pdf', { fileName: 'curs.pdf', content: pdf([wrap(asciiProse(3))]) }, 'application/pdf'],
      [
        'docx',
        { fileName: 'curs.docx', content: docx(['Un paragraf.']) },
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      ['txt', { fileName: 'curs.txt', content: txt(SAMPLE_TEXT) }, 'text/plain'],
    ])(
      'downloads a %s with its content type and exact bytes',
      async (_format, file, contentType) => {
        const id = await upload(ctx.app, user, subjectId, file);
        const response = await api('GET', `/documents/${id}/file`);
        expect(response.statusCode).toBe(200);
        expect(String(response.headers['content-type'])).toMatch(
          new RegExp(`^${contentType.replace('.', '\\.')}`),
        );
        expect(response.rawPayload.equals(file.content)).toBe(true);
        expect(Number(response.headers['content-length'])).toBe(file.content.length);
      },
    );

    it('is served as a passive download: nosniff, sandbox, not cached, named after the document', async () => {
      const id = await upload(ctx.app, user, subjectId, {
        fileName: 'Curs „1” – învățare.txt',
        content: txt(SAMPLE_TEXT),
      });
      const { headers } = await api('GET', `/documents/${id}/file`);
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(String(headers['content-security-policy'])).toContain('sandbox');
      expect(String(headers['cache-control'])).toContain('no-store');
      const disposition = String(headers['content-disposition']);
      expect(disposition).toMatch(/^inline/);
      expect(disposition).toContain(
        `filename*=UTF-8''${encodeURIComponent('Curs „1” – învățare.txt')}`,
      );
      expect(disposition).not.toMatch(/[\r\n]/);
    });

    it('uses the current name after a rename', async () => {
      const id = await upload(ctx.app, user, subjectId);
      await api('PATCH', `/documents/${id}`, user, { file_name: 'nume nou.txt' });
      const disposition = String(
        (await api('GET', `/documents/${id}/file`)).headers['content-disposition'],
      );
      expect(disposition).toContain(encodeURIComponent('nume nou.txt'));
    });

    it('is available before the analysis and after a failed one', async () => {
      const queued = await upload(ctx.app, user, subjectId);
      expect((await api('GET', `/documents/${queued}/file`)).statusCode).toBe(200);
      const failed = await readyDocument(ctx, user, subjectId, {
        fileName: 'x.txt',
        content: txt('scurt'),
      });
      expect((await api('GET', `/documents/${failed}/file`)).statusCode).toBe(200);
    });

    it('answers 404 to another student and without a session 401', async () => {
      const id = await upload(ctx.app, user, subjectId);
      const other = await registerStudent(ctx.app);
      expect((await api('GET', `/documents/${id}/file`, other)).statusCode).toBe(404);
      const anonymous = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/documents/${id}/file`,
      });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  it('reading a document that does not exist answers 404', async () => {
    expect((await api('GET', '/documents/999999999')).statusCode).toBe(404);
  });

  it('another student gets 404 for reading, renaming, deleting and reprocessing, and nothing changes', async () => {
    const id = await readyDocument(ctx, user, subjectId);
    const other = await registerStudent(ctx.app);
    const before = await documentRow(ctx.pool, id);
    expect((await api('GET', `/documents/${id}`, other)).statusCode).toBe(404);
    expect((await api('PATCH', `/documents/${id}`, other, { file_name: 'furat' })).statusCode).toBe(
      404,
    );
    expect((await api('DELETE', `/documents/${id}`, other)).statusCode).toBe(404);
    const reprocess = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/reprocess`,
      headers: other.headers,
    });
    expect(reprocess.statusCode).toBe(404);
    expect(await documentRow(ctx.pool, id)).toEqual(before);
  });
});
