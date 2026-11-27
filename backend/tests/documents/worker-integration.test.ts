import { deflateSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startWorker } from '../../src/core/worker.js';
import type { WorkerHandle } from '../../src/core/worker.js';
import { documentsWorkerTasks } from '../../src/modules/documents/service.js';
import {
  buildDocumentsTestApp,
  createSubject,
  documentRow,
  getDocument,
  upload,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { asciiProse, docx, pdf, prose, txt, wrap } from '../helpers/fixtures.js';
import { registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * Segment 2C, Q54: the queue runs in the REAL worker runtime (`startWorker`), with the real tasks
 * of the documents module, as `src/worker.ts` registers them. Nothing here calls
 * `processNextDocument` by hand. Design: sections 4 and 9.
 */
const POLL_MS = 50;
const silent = { info: () => undefined, error: () => undefined };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs: number,
  what: string,
): Promise<number> {
  const started = Date.now();
  while (!(await condition())) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`timed out after ${timeoutMs} ms: ${what}`);
    await wait(25);
  }
  return Date.now() - started;
}

/**
 * A PDF with a page of text and a contents stream followed by `megabytes` of spaces, packed into a
 * few hundred KB: reading it takes the child process a second or more, long enough to stop the
 * worker while it is reading.
 */
function slowPdf(megabytes: number): Buffer {
  const lines = wrap(asciiProse(2, 5, 12), 70).slice(0, 7);
  const text = `BT /F1 11 Tf 50 750 Td 14 TL ${lines.map((l) => `(${l}) '`).join(' ')} ET\n`;
  const packed = deflateSync(
    Buffer.concat([Buffer.from(text), Buffer.alloc(megabytes * 1024 * 1024, 0x20)]),
  );
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n' +
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
        `4 0 obj\n<< /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    ),
    packed,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n'),
  ]);
}

describe('the document queue in the real worker (Q54)', () => {
  let ctx: DocumentsTestApp;
  let user: TestUser;
  let subjectId: number;
  let worker: WorkerHandle | undefined;
  const opened: DocumentsTestApp[] = [];

  const startQueue = (app: DocumentsTestApp = ctx) => {
    worker = startWorker(
      documentsWorkerTasks(app.app.documents, { pollIntervalMs: POLL_MS }),
      silent,
    );
    return worker;
  };
  const statusOf = async (id: number) => (await documentRow(ctx.pool, id))?.status;
  const countByStatus = async (status: string) =>
    (await ctx.pool.query('SELECT count(*)::int AS n FROM documents WHERE status = $1', [status]))
      .rows[0].n as number;

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    user = await registerStudent(ctx.app);
    subjectId = await createSubject(ctx.app, user);
  });
  afterEach(async () => {
    ctx.analysis.release();
    await worker?.stop();
    worker = undefined;
    while (opened.length) await opened.pop()!.close();
    await ctx.pool.query(`DELETE FROM documents WHERE status IN ('queued', 'processing')`);
  });

  describe('a document goes from "queued" to "ready" with nothing else done', () => {
    it('a TXT, a DOCX and a PDF, within 5 s of the upload (C-02), without any concept', async () => {
      const startedAt = Date.now();
      const ids = [
        await upload(ctx.app, user, subjectId, { fileName: 'curs.txt', content: txt(prose(6)) }),
        await upload(ctx.app, user, subjectId, {
          fileName: 'curs.docx',
          content: docx(prose(4).split('\n\n')),
        }),
        await upload(ctx.app, user, subjectId, {
          fileName: 'curs.pdf',
          content: pdf([wrap(asciiProse(3)), wrap(asciiProse(3, 5, 9))]),
        }),
      ];
      for (const id of ids) expect(await statusOf(id)).toBe('queued'); // the upload does not process
      startQueue();

      await waitFor(
        async () => (await Promise.all(ids.map(statusOf))).every((s) => s === 'ready'),
        5000,
        'all three ready',
      );
      expect(Date.now() - startedAt).toBeLessThan(5000);
      for (const id of ids) {
        const body = (await getDocument(ctx.app, user, id)).json();
        expect(body).toMatchObject({ status: 'ready', error: null });
        expect(body.page_count).toBeGreaterThanOrEqual(1);
        expect(await ctx.app.documents.getStructureForAnalysis(id)).not.toBeNull();
      }
      // The analysis is the port (Q52): called once per document, and no concept was invented.
      expect([...ctx.analysis.calls].sort()).toEqual([...ids].sort());
      const concepts = await ctx.pool.query(
        'SELECT count(*)::int AS n FROM concepts WHERE subject_id = $1',
        [subjectId],
      );
      expect(concepts.rows[0].n).toBe(0);
    });

    it('a document uploaded while the worker runs is picked up within a poll interval or two', async () => {
      startQueue();
      await wait(120); // the first looks at an empty queue
      const startedAt = Date.now();
      const id = await upload(ctx.app, user, subjectId);
      await waitFor(async () => (await statusOf(id)) === 'ready', 5000, 'ready');
      expect(Date.now() - startedAt).toBeLessThan(2000);
    });

    it('takes ONE document at a time: the others wait in the queue', async () => {
      ctx.analysis.hang();
      const ids = [
        await upload(ctx.app, user, subjectId),
        await upload(ctx.app, user, subjectId),
        await upload(ctx.app, user, subjectId),
      ];
      startQueue();
      await ctx.analysis.started();
      await wait(300); // time enough for a second to be taken, if it could be
      expect(await countByStatus('processing')).toBe(1);
      expect(await countByStatus('queued')).toBe(2);
      ctx.analysis.release();
      await waitFor(
        async () => (await Promise.all(ids.map(statusOf))).every((s) => s === 'ready'),
        10_000,
        'all ready',
      );
    });
  });

  describe('a document deleted during its analysis (C-08)', () => {
    it('stays deleted, without passages, and the worker goes on', async () => {
      ctx.analysis.hang();
      const id = await upload(ctx.app, user, subjectId);
      startQueue();
      await ctx.analysis.started();
      expect(
        (
          await ctx.app.inject({
            method: 'DELETE',
            url: `/api/v1/documents/${id}`,
            headers: user.headers,
          })
        ).statusCode,
      ).toBe(204);

      ctx.analysis.release(); // the analysis now succeeds: a late result
      const next = await upload(ctx.app, user, subjectId); // proof that the queue did not stop
      await waitFor(
        async () => (await statusOf(next)) === 'ready',
        5000,
        'the next document is ready',
      );

      expect(await documentRow(ctx.pool, id)).toMatchObject({
        status: 'deleted',
        error_reason: null,
      });
      expect(
        (
          await ctx.pool.query('SELECT count(*)::int AS n FROM passages WHERE document_id = $1', [
            id,
          ])
        ).rows[0].n,
      ).toBe(0);
      expect((await getDocument(ctx.app, user, id)).statusCode).toBe(404);
    });
  });

  describe('a document that takes too long (T2, PE, C-10)', () => {
    it('becomes "error" with DOCUMENT_PROCESSING_TIMEOUT, and a result that arrives later changes nothing', async () => {
      const quick = await buildDocumentsTestApp({ DOCUMENT_PROCESSING_TIMEOUT_SECONDS: '1' });
      opened.push(quick);
      const student = await registerStudent(quick.app);
      const subject = await createSubject(quick.app, student);
      quick.analysis.hang(); // ignores the signal: only the limit can end it
      const id = await upload(quick.app, student, subject);
      startQueue(quick);

      await waitFor(async () => (await statusOf(id)) === 'error', 8000, 'error after the limit');
      expect(await documentRow(ctx.pool, id)).toMatchObject({
        status: 'error',
        error_reason: 'DOCUMENT_PROCESSING_TIMEOUT',
      });
      const body = (await getDocument(quick.app, student, id)).json();
      expect(body.error.code).toBe('DOCUMENT_PROCESSING_TIMEOUT');

      quick.analysis.release(); // the late result (success)
      const next = await upload(quick.app, student, subject);
      await waitFor(async () => (await statusOf(next)) === 'ready', 5000, 'the queue goes on');
      expect(await documentRow(ctx.pool, id)).toMatchObject({
        status: 'error',
        error_reason: 'DOCUMENT_PROCESSING_TIMEOUT',
      });
    }, 30_000);

    it('a document left in "processing" by a worker that died is failed when a worker starts', async () => {
      const id = await upload(ctx.app, user, subjectId);
      await ctx.pool.query(
        `UPDATE documents SET status = 'processing', processing_started_at = now() - interval '61 seconds' WHERE id = $1`,
        [id],
      );
      startQueue();
      await waitFor(async () => (await statusOf(id)) === 'error', 3000, 'failed on start');
      expect(await documentRow(ctx.pool, id)).toMatchObject({
        error_reason: 'DOCUMENT_PROCESSING_TIMEOUT',
      });
    });
  });

  describe('stopping the worker (Q54)', () => {
    it('lets the document in hand finish and takes no new one; its analysis is not told to stop', async () => {
      ctx.analysis.hang();
      const first = await upload(ctx.app, user, subjectId);
      const second = await upload(ctx.app, user, subjectId);
      const running = startQueue();
      await ctx.analysis.started();

      const stopping = running.stop();
      await wait(300);
      expect(await statusOf(first)).toBe('processing'); // not failed, not abandoned
      expect(ctx.analysis.lastSignalAborted()).toBe(false); // the stop signal did not reach it

      ctx.analysis.release();
      await stopping;
      expect(await statusOf(first)).toBe('ready');
      expect(await statusOf(second)).toBe('queued'); // no new document after the stop
    });

    it('does not kill the child process that is reading a PDF: the document ends "ready", not "error"', async () => {
      const id = await upload(ctx.app, user, subjectId, {
        fileName: 'lent.pdf',
        content: slowPdf(200),
      });
      const running = startQueue();
      await waitFor(
        async () => (await statusOf(id)) === 'processing',
        5000,
        'the reading has started',
      );

      await running.stop(); // returns when the document in hand is done
      expect(await documentRow(ctx.pool, id)).toMatchObject({
        status: 'ready',
        error_reason: null,
      });
      expect(
        (
          await ctx.pool.query('SELECT count(*)::int AS n FROM passages WHERE document_id = $1', [
            id,
          ])
        ).rows[0].n,
      ).toBeGreaterThan(0);
    }, 60_000);
  });
});
