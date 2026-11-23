import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/auth-app.js';
import {
  SAMPLE_TEXT,
  actorOf,
  buildDocumentsTestApp,
  createSubject,
  documentRow,
  getDocument,
  processQueue,
  readyDocument,
  upload,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { asciiProse, docx, pdf, prose, txt, wrap } from '../helpers/fixtures.js';
import { registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';
import { expectPassagesOfAtLeast100Words, expectValidStructure } from '../helpers/structure.js';

/**
 * RF4 — background analysis and the document states (Dosar, Tabelul 3.1), with the three
 * "unforeseen" cells: C-08 (deleted while processing), C-09 (reprocess while processing),
 * C-10 (result after the time limit). Design: section 4.
 */
describe('document processing and states (RF4, C-08, C-09, C-10)', () => {
  let ctx: DocumentsTestApp;
  let user: TestUser;
  let subjectId: number;

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    user = await registerStudent(ctx.app);
    subjectId = await createSubject(ctx.app, user);
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    ctx.analysis.release();
    ctx.analysis.succeed();
    ctx.analysis.calls.length = 0;
    // Nothing left in the queue from a previous test.
    await ctx.pool.query(`DELETE FROM documents WHERE status IN ('queued', 'processing')`);
  });

  const api = (method: 'GET' | 'POST' | 'DELETE', url: string) =>
    ctx.app.inject({ method, url: `/api/v1${url}`, headers: user.headers });
  const status = async (id: number) => (await documentRow(ctx.pool, id))?.status;
  const passageCount = async (id: number) =>
    (await ctx.pool.query('SELECT count(*)::int AS n FROM passages WHERE document_id = $1', [id]))
      .rows[0].n as number;

  describe('the normal path: queued → processing → ready', () => {
    it('processNextDocument answers false when the queue is empty', async () => {
      expect(await ctx.app.documents.processNextDocument()).toBe(false);
    });

    it('a processed document is ready, with its page count, passages and sentences', async () => {
      const id = await upload(ctx.app, user, subjectId);
      expect(await ctx.app.documents.processNextDocument()).toBe(true);

      const body = (await getDocument(ctx.app, user, id)).json();
      expect(body).toMatchObject({ status: 'ready', error: null });
      expect(body.page_count).toBeGreaterThanOrEqual(1);

      const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), id);
      expectValidStructure(structure);
      expectPassagesOfAtLeast100Words(structure);
      expect(structure.text).toBe(SAMPLE_TEXT);
      expect(structure.pageCount).toBe(body.page_count);
      expect(await passageCount(id)).toBe(structure.passages.length);
    });

    it.each([
      [
        'PDF',
        { fileName: 'curs.pdf', content: pdf([wrap(asciiProse(4)), wrap(asciiProse(4, 5, 9))]) },
        2,
      ],
      ['DOCX', { fileName: 'curs.docx', content: docx(prose(4).split('\n\n')) }, 1],
      ['TXT', { fileName: 'curs.txt', content: txt(prose(4)) }, 1],
    ])('works for %s', async (_name, file, pages) => {
      const id = await readyDocument(ctx, user, subjectId, file);
      const body = (await getDocument(ctx.app, user, id)).json();
      expect(body).toMatchObject({ status: 'ready', page_count: pages });
      expectValidStructure(await ctx.app.documents.getDocumentStructure(actorOf(user), id));
    });

    it('while it is being analysed the document is "processing" (C-02)', async () => {
      ctx.analysis.hang();
      const id = await upload(ctx.app, user, subjectId);
      const running = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();
      expect((await getDocument(ctx.app, user, id)).json().status).toBe('processing');
      expect((await documentRow(ctx.pool, id))!.processing_started_at).not.toBeNull();
      ctx.analysis.release();
      await running;
      expect((await getDocument(ctx.app, user, id)).json().status).toBe('ready');
    });

    it('the status response is never cached, so polling sees the change (C-02)', async () => {
      const id = await upload(ctx.app, user, subjectId);
      expect(String((await getDocument(ctx.app, user, id)).headers['cache-control'])).toContain(
        'no-store',
      );
    });

    it('documents are processed oldest first, one per call', async () => {
      const first = await upload(ctx.app, user, subjectId);
      const second = await upload(ctx.app, user, subjectId);
      await ctx.pool.query(
        `UPDATE documents SET uploaded_at = now() - interval '1 minute' WHERE id = $1`,
        [second],
      );
      await ctx.app.documents.processNextDocument();
      expect(await status(second)).toBe('ready');
      expect(await status(first)).toBe('queued');
      expect(await processQueue(ctx.app)).toBe(1);
      expect(ctx.analysis.calls).toEqual([second, first]);
    });

    it('two workers never take the same document', async () => {
      ctx.analysis.hang();
      const ids = [await upload(ctx.app, user, subjectId), await upload(ctx.app, user, subjectId)];
      const running = [
        ctx.app.documents.processNextDocument(),
        ctx.app.documents.processNextDocument(),
      ];
      await ctx.analysis.started();
      await new Promise((resolve) => setTimeout(resolve, 200));
      ctx.analysis.release();
      expect(await Promise.all(running)).toEqual([true, true]);
      expect([...ctx.analysis.calls].sort()).toEqual([...ids].sort());
    });

    it('the analysis is called once per document, with its id, after the text is stored', async () => {
      const id = await upload(ctx.app, user, subjectId);
      await processQueue(ctx.app);
      expect(ctx.analysis.calls).toEqual([id]);
    });

    it('the analysis can read the stored structure without a user', async () => {
      const id = await readyDocument(ctx, user, subjectId);
      const structure = await ctx.app.documents.getStructureForAnalysis(id);
      expect(structure).not.toBeNull();
      expect(structure!.documentId).toBe(id);
      expectValidStructure(structure!);
      expect(await ctx.app.documents.getStructureForAnalysis(999_999_999)).toBeNull();
    });
  });

  describe('failures: processing → error, with the reason (RF4)', () => {
    const failed = async (file: { fileName: string; content: Buffer }) => {
      const id = await upload(ctx.app, user, subjectId, file);
      await processQueue(ctx.app);
      return { id, body: (await getDocument(ctx.app, user, id)).json() };
    };

    it('a file with too little text is TEXT_NOT_EXTRACTABLE, with message M06', async () => {
      const { id, body } = await failed({
        fileName: 'scurt.txt',
        content: txt('Prea puțin text.'),
      });
      expect(body.status).toBe('error');
      expect(body.error.code).toBe('TEXT_NOT_EXTRACTABLE');
      expect(body.error.message).toMatch(/textul poate fi selectat/);
      expect(body.page_count).toBeNull();
      expect(await passageCount(id)).toBe(0);
      expect(ctx.analysis.calls).toEqual([]);
    });

    it('a scanned PDF (pages without text) is TEXT_NOT_EXTRACTABLE', async () => {
      const { body } = await failed({ fileName: 'scanat.pdf', content: pdf([[], [], []]) });
      expect(body).toMatchObject({ status: 'error', error: { code: 'TEXT_NOT_EXTRACTABLE' } });
    });

    it('a corrupt file is TEXT_NOT_EXTRACTABLE', async () => {
      const content = Buffer.from('%PDF-1.4\nnu este un pdf adevarat\n%%EOF\n', 'latin1');
      const { body } = await failed({ fileName: 'corupt.pdf', content });
      expect(body).toMatchObject({ status: 'error', error: { code: 'TEXT_NOT_EXTRACTABLE' } });
    });

    it('a document over the page limit is FILE_TOO_LARGE, with message M05, and stores no text (Q48)', async () => {
      const limited = await buildDocumentsTestApp({ UPLOAD_MAX_PAGES: '2' });
      try {
        const student = await registerStudent(limited.app);
        const subject = await createSubject(limited.app, student);
        const id = await upload(limited.app, student, subject, {
          fileName: 'lung.pdf',
          content: pdf([wrap(asciiProse(3)), wrap(asciiProse(3)), wrap(asciiProse(3))]),
        });
        await processQueue(limited.app);
        const body = (await getDocument(limited.app, student, id)).json();
        expect(body.status).toBe('error');
        expect(body.error.code).toBe('FILE_TOO_LARGE');
        expect(body.error.message).toMatch(/limita/);
        expect(
          (
            await limited.pool.query(
              'SELECT count(*)::int AS n FROM passages WHERE document_id = $1',
              [id],
            )
          ).rows[0].n,
        ).toBe(0);
      } finally {
        await limited.close();
      }
    });

    it('a failed analysis is the error it threw: LLM_UNAVAILABLE, with message M07', async () => {
      ctx.analysis.failWith('LLM_UNAVAILABLE');
      const { id, body } = await failed({ fileName: 'curs.txt', content: txt(SAMPLE_TEXT) });
      expect(body.status).toBe('error');
      expect(body.error.code).toBe('LLM_UNAVAILABLE');
      expect(body.error.message).toMatch(/Serviciul de analiză nu este disponibil/);
      // The text was extracted before the analysis and is kept (Q47).
      expect(await passageCount(id)).toBeGreaterThan(0);
      expect(body.page_count).toBeGreaterThanOrEqual(1);
    });

    it('an unexpected exception is INTERNAL_ERROR and the queue goes on', async () => {
      const broken = await buildDocumentsTestApp(
        {},
        { textExtractor: { extract: () => Promise.reject(new Error('boom')) } },
      );
      try {
        const student = await registerStudent(broken.app);
        const subject = await createSubject(broken.app, student);
        const first = await upload(broken.app, student, subject);
        const second = await upload(broken.app, student, subject);
        expect(await processQueue(broken.app)).toBe(2);
        for (const id of [first, second]) {
          const body = (await getDocument(broken.app, student, id)).json();
          expect(body).toMatchObject({ status: 'error', error: { code: 'INTERNAL_ERROR' } });
        }
        expect(broken.logs.join('\n')).not.toContain(SAMPLE_TEXT.slice(0, 40));
      } finally {
        await broken.close();
      }
    });

    it('the passages of a document in error cannot be listed: 409 DOCUMENT_NOT_READY', async () => {
      ctx.analysis.failWith('LLM_UNAVAILABLE');
      const { id } = await failed({ fileName: 'curs.txt', content: txt(SAMPLE_TEXT) });
      const response = await api('GET', `/documents/${id}/passages`);
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('DOCUMENT_NOT_READY');
    });
  });

  describe('the time limit (T2, event PE)', () => {
    it('an analysis longer than the limit ends in error DOCUMENT_PROCESSING_TIMEOUT', async () => {
      const quick = await buildDocumentsTestApp({ DOCUMENT_PROCESSING_TIMEOUT_SECONDS: '1' });
      try {
        const student = await registerStudent(quick.app);
        const subject = await createSubject(quick.app, student);
        quick.analysis.hang({ respectAbort: true });
        const id = await upload(quick.app, student, subject);
        const started = Date.now();
        await quick.app.documents.processNextDocument();
        expect(Date.now() - started).toBeLessThan(5000);
        expect(quick.analysis.lastSignalAborted()).toBe(true);
        const body = (await getDocument(quick.app, student, id)).json();
        expect(body).toMatchObject({
          status: 'error',
          error: { code: 'DOCUMENT_PROCESSING_TIMEOUT' },
        });
        expect(body.error.message).toMatch(/prea mult/);
      } finally {
        await quick.close();
      }
    });

    it('failStuckDocuments moves documents stuck in processing to error, and only those', async () => {
      ctx.analysis.hang();
      const stuck = await upload(ctx.app, user, subjectId);
      const running = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();
      const queued = await upload(ctx.app, user, subjectId);

      expect(await ctx.app.documents.failStuckDocuments()).toBe(0); // still within the limit
      await ctx.pool.query(
        `UPDATE documents SET processing_started_at = now() - interval '61 seconds' WHERE id = $1`,
        [stuck],
      );
      expect(await ctx.app.documents.failStuckDocuments()).toBe(1);
      expect(await documentRow(ctx.pool, stuck)).toMatchObject({
        status: 'error',
        error_reason: 'DOCUMENT_PROCESSING_TIMEOUT',
      });
      expect(await status(queued)).toBe('queued');

      // C-10: the result that arrives after the limit is rejected and changes nothing.
      ctx.analysis.release();
      await running;
      expect(await documentRow(ctx.pool, stuck)).toMatchObject({
        status: 'error',
        error_reason: 'DOCUMENT_PROCESSING_TIMEOUT',
      });
    });
  });

  describe('C-08: deleting a document that is being analysed', () => {
    it('the late result is ignored: the document stays deleted, without passages', async () => {
      ctx.analysis.hang();
      const id = await upload(ctx.app, user, subjectId);
      const running = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();

      expect((await api('DELETE', `/documents/${id}`)).statusCode).toBe(204);
      ctx.analysis.release();
      await expect(running).resolves.toBe(true);

      expect(await status(id)).toBe('deleted');
      expect(await passageCount(id)).toBe(0);
      expect((await getDocument(ctx.app, user, id)).statusCode).toBe(404);
    });

    it('a late failure is ignored too', async () => {
      ctx.analysis.hang({ respectAbort: true });
      const id = await upload(ctx.app, user, subjectId);
      const running = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();
      await api('DELETE', `/documents/${id}`);
      ctx.analysis.release();
      await running;
      expect(await documentRow(ctx.pool, id)).toMatchObject({
        status: 'deleted',
        error_reason: null,
      });
    });

    it('deleting the whole subject while a document is analysed does not break the worker', async () => {
      const doomed = await createSubject(ctx.app, user);
      ctx.analysis.hang();
      const id = await upload(ctx.app, user, doomed);
      const running = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();
      expect((await api('DELETE', `/subjects/${doomed}`)).statusCode).toBe(204);
      ctx.analysis.release();
      await expect(running).resolves.toBe(true);
      expect(await documentRow(ctx.pool, id)).toBeUndefined();
    });
  });

  describe('reprocessing (RF6, event RP, C-09)', () => {
    it('a ready document goes back to the queue: 202 with status queued', async () => {
      const id = await readyDocument(ctx, user, subjectId);
      const response = await api('POST', `/documents/${id}/reprocess`);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ id, status: 'queued', error: null });
      await processQueue(ctx.app);
      expect(await status(id)).toBe('ready');
    });

    it('a document in error goes back to the queue and loses its error', async () => {
      ctx.analysis.failWith('LLM_UNAVAILABLE');
      const id = await readyDocument(ctx, user, subjectId);
      expect(await status(id)).toBe('error');
      ctx.analysis.succeed();
      const response = await api('POST', `/documents/${id}/reprocess`);
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ status: 'queued', error: null });
      await processQueue(ctx.app);
      expect((await getDocument(ctx.app, user, id)).json()).toMatchObject({
        status: 'ready',
        error: null,
      });
    });

    it('C-09: a queued document answers 409 DOCUMENT_ALREADY_PROCESSING and stays queued once', async () => {
      const id = await upload(ctx.app, user, subjectId);
      const response = await api('POST', `/documents/${id}/reprocess`);
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('DOCUMENT_ALREADY_PROCESSING');
      expect(errorOf(response).message).toBe('Documentul este deja în procesare.');
      expect(await processQueue(ctx.app)).toBe(1);
      expect(ctx.analysis.calls).toEqual([id]);
    });

    it('C-09: a document being analysed answers 409 and no second analysis starts', async () => {
      ctx.analysis.hang();
      const id = await upload(ctx.app, user, subjectId);
      const running = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();
      const response = await api('POST', `/documents/${id}/reprocess`);
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('DOCUMENT_ALREADY_PROCESSING');
      expect(await ctx.app.documents.processNextDocument()).toBe(false);
      ctx.analysis.release();
      await running;
      expect(ctx.analysis.calls).toEqual([id]);
    });

    it('does not extract the text again: the passages keep their ids (Q47)', async () => {
      const id = await readyDocument(ctx, user, subjectId);
      const before = await ctx.pool.query(
        'SELECT id, text FROM passages WHERE document_id = $1 ORDER BY position',
        [id],
      );
      await api('POST', `/documents/${id}/reprocess`);
      await processQueue(ctx.app);
      const after = await ctx.pool.query(
        'SELECT id, text FROM passages WHERE document_id = $1 ORDER BY position',
        [id],
      );
      expect(after.rows).toEqual(before.rows);
      expect(ctx.analysis.calls).toEqual([id, id]); // only the analysis ran again
    });

    it('a document that failed before its text was stored is extracted again', async () => {
      let fail = true;
      const flaky = await buildDocumentsTestApp(
        {},
        {
          textExtractor: {
            extract: async () => {
              if (fail) throw new Error('disk hiccup');
              return { paged: false, pages: [{ number: 1, text: SAMPLE_TEXT }] };
            },
          },
        },
      );
      try {
        const student = await registerStudent(flaky.app);
        const subject = await createSubject(flaky.app, student);
        const id = await readyDocument(flaky, student, subject);
        expect((await getDocument(flaky.app, student, id)).json().status).toBe('error');
        fail = false;
        await flaky.app.inject({
          method: 'POST',
          url: `/api/v1/documents/${id}/reprocess`,
          headers: student.headers,
        });
        await processQueue(flaky.app);
        expect((await getDocument(flaky.app, student, id)).json().status).toBe('ready');
        expectValidStructure(await flaky.app.documents.getDocumentStructure(actorOf(student), id));
      } finally {
        await flaky.close();
      }
    });

    it('a result from before the reprocessing does not finish the new analysis (C-10)', async () => {
      ctx.analysis.hang();
      const id = await upload(ctx.app, user, subjectId);
      const firstRun = ctx.app.documents.processNextDocument();
      await ctx.analysis.started();
      // The first analysis exceeds the limit; the student reprocesses; a second worker claims it.
      await ctx.pool.query(
        `UPDATE documents SET processing_started_at = now() - interval '61 seconds' WHERE id = $1`,
        [id],
      );
      await ctx.app.documents.failStuckDocuments();
      expect((await api('POST', `/documents/${id}/reprocess`)).statusCode).toBe(202);
      await ctx.pool.query(
        `UPDATE documents SET status = 'processing', processing_started_at = now() WHERE id = $1`,
        [id],
      );
      ctx.analysis.release();
      await firstRun;
      expect(await status(id)).toBe('processing'); // the late result of the first run was dropped
    });

    it('answers 404 for a document that does not exist or is deleted', async () => {
      expect((await api('POST', '/documents/999999999/reprocess')).statusCode).toBe(404);
      const id = await readyDocument(ctx, user, subjectId);
      await api('DELETE', `/documents/${id}`);
      expect((await api('POST', `/documents/${id}/reprocess`)).statusCode).toBe(404);
    });
  });
});
