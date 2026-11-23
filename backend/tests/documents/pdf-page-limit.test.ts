import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/auth-app.js';
import {
  buildDocumentsTestApp,
  clearSetting,
  createSubject,
  documentRow,
  fakePageCounter,
  getDocument,
  processQueue,
  setSetting,
  upload,
  uploadRequest,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { asciiProse, pdf, prose, txt, wrap } from '../helpers/fixtures.js';
import { registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/**
 * Q48: the pages of a PDF are counted AT UPLOAD, without extracting the text, with a timeout and
 * a memory limit. A file that cannot be read is let through (the analysis decides, M06); a file
 * that cannot be counted within the limits is refused as too complex. Design: section 2.5.
 */
const page = () => wrap(asciiProse(2));
const PAGES_OVER = pdf([page(), page(), page()]); // 3 pages
/** More than two pages of 3000 characters (Q16): over a limit of 2 pages. */
const LONG_TEXT = prose(16, 5, 12);
const COMPLEX_MESSAGE = /prea complex/;

async function student(ctx: DocumentsTestApp) {
  const user = await registerStudent(ctx.app);
  return { user, subjectId: await createSubject(ctx.app, user) };
}
const countDocuments = async (ctx: DocumentsTestApp) =>
  (await ctx.pool.query('SELECT count(*)::int AS n FROM documents')).rows[0].n as number;
const quotaOf = async (ctx: DocumentsTestApp, user: TestUser) =>
  (
    await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/documents/upload-quota',
      headers: user.headers,
    })
  ).json();

describe('the pages of a PDF are counted at upload (Q48)', () => {
  describe('with the real counter', () => {
    let ctx: DocumentsTestApp;

    beforeAll(async () => {
      ctx = await buildDocumentsTestApp({ UPLOAD_MAX_PAGES: '2' });
    });
    afterAll(() => ctx.close());

    it('refuses a PDF over the limit with 413 FILE_TOO_LARGE and says how many pages it has', async () => {
      const { user, subjectId } = await student(ctx);
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'lung.pdf',
        content: PAGES_OVER,
      });
      expect(response.statusCode).toBe(413);
      const error = errorOf(response);
      expect(error.code).toBe('FILE_TOO_LARGE');
      expect(error.details).toEqual({ exceeded: 'pages', limit_mb: 20, limit_pages: 2, pages: 3 });
    });

    it('leaves no row and no file, and does not use up the daily limit', async () => {
      const { user, subjectId } = await student(ctx);
      const rows = await countDocuments(ctx);
      const files = ctx.storedFiles().length;
      await uploadRequest(ctx.app, user, subjectId, { fileName: 'lung.pdf', content: PAGES_OVER });
      expect(await countDocuments(ctx)).toBe(rows);
      expect(ctx.storedFiles()).toHaveLength(files);
      expect(await quotaOf(ctx, user)).toMatchObject({ used: 0 });
    });

    it('accepts a PDF of exactly the limit', async () => {
      const { user, subjectId } = await student(ctx);
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'doua.pdf',
        content: pdf([page(), page()]),
      });
      expect(response.statusCode).toBe(201);
    });

    it('counts pages without text too, so it does not read the text (a scanned PDF is not "M06" here)', async () => {
      const { user, subjectId } = await student(ctx);
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'scanat.pdf',
        content: pdf([[], [], [], []]),
      });
      expect(response.statusCode).toBe(413);
      expect(errorOf(response).details).toMatchObject({ exceeded: 'pages', pages: 4 });
    });

    it('does not count DOCX and TXT at upload: they are accepted and the analysis decides', async () => {
      const { user, subjectId } = await student(ctx);
      const id = await upload(ctx.app, user, subjectId, {
        fileName: 'lung.txt',
        content: txt(LONG_TEXT), // more than 6000 characters: 3 pages of 3000, over the limit of 2
      });
      await processQueue(ctx.app);
      expect((await getDocument(ctx.app, user, id)).json()).toMatchObject({
        status: 'error',
        error: { code: 'FILE_TOO_LARGE' },
      });
    });

    describe('a PDF that cannot be read is let through; the analysis decides (M06)', () => {
      it.each([
        [
          'a corrupt PDF',
          'corupt.pdf',
          Buffer.from('%PDF-1.4\nnu este un pdf adevarat\n%%EOF\n', 'latin1'),
        ],
        ['a PDF cut in half', 'taiat.pdf', PAGES_OVER.subarray(0, 300)],
        ['a password-protected PDF', 'protejat.pdf', pdf([page()], { password: 'secret' })],
      ])(
        '%s: accepted at upload, TEXT_NOT_EXTRACTABLE at analysis',
        async (_name, fileName, content) => {
          const { user, subjectId } = await student(ctx);
          const response = await uploadRequest(ctx.app, user, subjectId, { fileName, content });
          expect(response.statusCode).toBe(201);
          expect(response.json()).toMatchObject({ status: 'queued', page_count: null });
          await processQueue(ctx.app);
          const body = (await getDocument(ctx.app, user, response.json().id)).json();
          expect(body).toMatchObject({ status: 'error', error: { code: 'TEXT_NOT_EXTRACTABLE' } });
          expect(body.error.message).toMatch(/textul poate fi selectat/);
        },
      );

      it('and it counts as an upload of the day', async () => {
        const { user, subjectId } = await student(ctx);
        await uploadRequest(ctx.app, user, subjectId, {
          fileName: 'protejat.pdf',
          content: pdf([page()], { password: 'secret' }),
        });
        expect(await quotaOf(ctx, user)).toMatchObject({ used: 1 });
      });
    });

    it('follows UPLOAD_MAX_PAGES', async () => {
      const wide = await buildDocumentsTestApp({ UPLOAD_MAX_PAGES: '5' });
      try {
        const { user, subjectId } = await student(wide);
        const response = await uploadRequest(wide.app, user, subjectId, {
          fileName: 'trei.pdf',
          content: PAGES_OVER,
        });
        expect(response.statusCode).toBe(201);
      } finally {
        await wide.close();
      }
    });
  });

  describe('when counting hits its limits: refused as too complex', () => {
    it.each([
      ['timeout', { kind: 'timeout' as const }],
      ['memory', { kind: 'memory' as const }],
    ])(
      'a %s answers 413 FILE_TOO_LARGE with its own message and the reason',
      async (reason, outcome) => {
        const counter = fakePageCounter(outcome);
        const ctx = await buildDocumentsTestApp({}, { pdfPageCounter: counter });
        try {
          const { user, subjectId } = await student(ctx);
          const rows = await countDocuments(ctx);
          const files = ctx.storedFiles().length;

          const response = await uploadRequest(ctx.app, user, subjectId, {
            fileName: 'complex.pdf',
            content: pdf([page()]),
          });
          expect(response.statusCode).toBe(413);
          const error = errorOf(response);
          expect(error.code).toBe('FILE_TOO_LARGE');
          expect(error.message).toMatch(COMPLEX_MESSAGE);
          expect(error.details).toEqual({
            exceeded: 'complexity',
            reason,
            limit_mb: 20,
            limit_pages: 100,
          });
          // As for any refused file: no row, no file, no use of the daily limit.
          expect(await countDocuments(ctx)).toBe(rows);
          expect(ctx.storedFiles()).toHaveLength(files);
          expect(await quotaOf(ctx, user)).toMatchObject({ used: 0 });
        } finally {
          await ctx.close();
        }
      },
    );

    it('a timeout is not the same as an unreadable file: only the second is let through', async () => {
      const unreadable = await buildDocumentsTestApp(
        {},
        { pdfPageCounter: fakePageCounter({ kind: 'unreadable' }) },
      );
      const slow = await buildDocumentsTestApp(
        {},
        { pdfPageCounter: fakePageCounter({ kind: 'timeout' }) },
      );
      try {
        const file = { fileName: 'x.pdf', content: pdf([page()]) };
        const a = await student(unreadable);
        const b = await student(slow);
        expect((await uploadRequest(unreadable.app, a.user, a.subjectId, file)).statusCode).toBe(
          201,
        );
        expect((await uploadRequest(slow.app, b.user, b.subjectId, file)).statusCode).toBe(413);
      } finally {
        await unreadable.close();
        await slow.close();
      }
    });
  });

  describe('how the counter is used', () => {
    let ctx: DocumentsTestApp;
    const counter = fakePageCounter({ kind: 'pages', pages: 1 });

    beforeAll(async () => {
      ctx = await buildDocumentsTestApp({}, { pdfPageCounter: counter });
    });
    afterAll(() => ctx.close());

    it('is given the exact bytes of the PDF and the configured limits (5 s, 256 MB)', async () => {
      const { user, subjectId } = await student(ctx);
      const content = pdf([page()]);
      counter.calls.length = 0;
      await uploadRequest(ctx.app, user, subjectId, { fileName: 'a.pdf', content });
      expect(counter.calls).toHaveLength(1);
      expect(counter.calls[0]!.content.equals(content)).toBe(true);
      expect(counter.calls[0]!.limits).toEqual({ timeoutMs: 5000, maxMemoryMb: 256 });
    });

    it('is given other limits when the configuration says so', async () => {
      const other = fakePageCounter({ kind: 'pages', pages: 1 });
      const tuned = await buildDocumentsTestApp(
        { PDF_PAGE_COUNT_TIMEOUT_SECONDS: '2', PDF_PAGE_COUNT_MEMORY_MB: '128' },
        { pdfPageCounter: other },
      );
      try {
        const { user, subjectId } = await student(tuned);
        await uploadRequest(tuned.app, user, subjectId, {
          fileName: 'a.pdf',
          content: pdf([page()]),
        });
        expect(other.calls[0]!.limits).toEqual({ timeoutMs: 2000, maxMemoryMb: 128 });
      } finally {
        await tuned.close();
      }
    });

    it('is asked only about PDF files', async () => {
      const { user, subjectId } = await student(ctx);
      counter.calls.length = 0;
      await uploadRequest(ctx.app, user, subjectId, { fileName: 'a.txt', content: txt(prose(2)) });
      expect(counter.calls).toHaveLength(0);
    });

    it('is not asked about a file already refused for its format or its size', async () => {
      const { user, subjectId } = await student(ctx);
      counter.calls.length = 0;
      await uploadRequest(ctx.app, user, subjectId, { fileName: 'fals.pdf', content: txt('nu') });
      await setSetting(ctx.pool, 'max_file_size_mb', 1);
      try {
        const big = Buffer.concat([pdf([page()]), Buffer.alloc(1024 * 1024, 0x20)]);
        const response = await uploadRequest(ctx.app, user, subjectId, {
          fileName: 'mare.pdf',
          content: big,
        });
        expect(response.statusCode).toBe(413);
        expect(errorOf(response).details).toMatchObject({ exceeded: 'size' });
      } finally {
        await clearSetting(ctx.pool, 'max_file_size_mb');
      }
      expect(counter.calls).toHaveLength(0);
    });

    it('is asked before the daily limit: a PDF that is too long is 413 even when the limit is used up', async () => {
      const full = fakePageCounter({ kind: 'pages', pages: 500 });
      const small = await buildDocumentsTestApp(
        { DEFAULT_UPLOADS_PER_DAY: '1' },
        { pdfPageCounter: full },
      );
      try {
        const { user, subjectId } = await student(small);
        full.calls.length = 0;
        // Use up the single upload of the day with a text file, then try a long PDF.
        await upload(small.app, user, subjectId);
        const response = await uploadRequest(small.app, user, subjectId, {
          fileName: 'lung.pdf',
          content: pdf([page()]),
        });
        expect(response.statusCode).toBe(413);
        expect(errorOf(response).details).toMatchObject({ exceeded: 'pages', pages: 500 });
      } finally {
        await small.close();
      }
    });

    it('a defect in the counter does not block the upload: it goes on and the error is logged without the file name', async () => {
      const broken = await buildDocumentsTestApp(
        {},
        { pdfPageCounter: { count: () => Promise.reject(new Error('counter crashed')) } },
      );
      try {
        const { user, subjectId } = await student(broken);
        const response = await uploadRequest(broken.app, user, subjectId, {
          fileName: 'nume-secret.pdf',
          content: pdf([page()]),
        });
        expect(response.statusCode).toBe(201);
        const lines = broken.logs.join('\n');
        expect(lines).toMatch(/"level":50/);
        expect(lines).not.toContain('nume-secret');
        expect(await documentRow(broken.pool, response.json().id)).toMatchObject({
          status: 'queued',
        });
      } finally {
        await broken.close();
      }
    });
  });
});
