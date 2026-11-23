import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/auth-app.js';
import {
  SAMPLE_TEXT,
  buildDocumentsTestApp,
  clearSetting,
  createSubject,
  documentRow,
  setSetting,
  uploadRequest,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { asciiProse, docx, pdf, txt, wrap, zip } from '../helpers/fixtures.js';
import { registerAdmin, registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/** UC-04 — RF3 (upload), EV1, M04, M05, C-03. Design: section 2. */
describe('uploading a document (UC-04, RF3)', () => {
  let ctx: DocumentsTestApp;
  let user: TestUser;
  let subjectId: number;

  const VALID_TXT = { fileName: 'curs.txt', content: txt(SAMPLE_TEXT) };
  const VALID_DOCX = { fileName: 'curs.docx', content: docx(['Primul paragraf.', 'Al doilea.']) };
  const VALID_PDF = { fileName: 'curs.pdf', content: pdf([wrap(asciiProse(3))]) };

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    user = await registerStudent(ctx.app);
    subjectId = await createSubject(ctx.app, user);
  });
  afterAll(() => ctx.close());

  const countDocuments = async () =>
    (await ctx.pool.query('SELECT count(*)::int AS n FROM documents')).rows[0].n as number;

  describe('a valid file', () => {
    it('answers 201 with a queued document', async () => {
      const response = await uploadRequest(ctx.app, user, subjectId, VALID_TXT);
      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        subject_id: subjectId,
        file_name: 'curs.txt',
        format: 'txt',
        size_bytes: VALID_TXT.content.length,
        page_count: null,
        status: 'queued',
        error: null,
      });
      expect(Math.abs(new Date(body.uploaded_at).getTime() - Date.now())).toBeLessThan(10_000);
    });

    it.each([
      ['PDF', VALID_PDF, 'pdf'],
      ['DOCX', VALID_DOCX, 'docx'],
      ['TXT', VALID_TXT, 'txt'],
    ])('accepts %s', async (_name, file, format) => {
      const response = await uploadRequest(ctx.app, user, subjectId, file);
      expect(response.statusCode).toBe(201);
      expect(response.json().format).toBe(format);
    });

    it('reads the format from the extension without regard to case', async () => {
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'CURS.PDF',
        content: VALID_PDF.content,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ format: 'pdf', file_name: 'CURS.PDF' });
    });

    it('ignores the Content-Type the browser declares', async () => {
      const response = await uploadRequest(ctx.app, user, subjectId, {
        ...VALID_TXT,
        contentType: 'application/x-msdownload',
      });
      expect(response.statusCode).toBe(201);
    });

    it('stores the bytes unchanged: the download returns exactly what was sent', async () => {
      const content = txt(`${SAMPLE_TEXT}\r\n\r\n  spații   multe  \t la final   `);
      const id = (
        await uploadRequest(ctx.app, user, subjectId, { fileName: 'exact.txt', content })
      ).json().id;
      const download = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/documents/${id}/file`,
        headers: user.headers,
      });
      expect(download.statusCode).toBe(200);
      expect(download.rawPayload.equals(content)).toBe(true);
    });

    it('lets two documents have the same name', async () => {
      const first = await uploadRequest(ctx.app, user, subjectId, VALID_TXT);
      const second = await uploadRequest(ctx.app, user, subjectId, VALID_TXT);
      expect(second.statusCode).toBe(201);
      expect(second.json().id).not.toBe(first.json().id);
    });
  });

  describe('the file name (design 2.3)', () => {
    it.each([
      ['a Unix path', '../../etc/passwd.txt', 'passwd.txt'],
      ['a Windows path', 'C:\\Users\\ana\\note curs.txt', 'note curs.txt'],
      ['diacritics and spaces', 'Curs 3 – Învățare automată.txt', 'Curs 3 – Învățare automată.txt'],
    ])('keeps only the last component of %s', async (_case, sent, stored) => {
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: sent,
        content: VALID_TXT.content,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().file_name).toBe(stored);
    });

    it('cuts a very long name to 255 characters and keeps the format', async () => {
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: `${'n'.repeat(300)}.txt`,
        content: VALID_TXT.content,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().file_name.length).toBeLessThanOrEqual(255);
      expect(response.json().format).toBe('txt');
    });
  });

  describe('format (M04)', () => {
    it.each([
      ['a .pptx', 'prezentare.pptx', zip([{ name: 'ppt/presentation.xml', content: '<p/>' }])],
      ['an old .doc', 'vechi.doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
      ['an image', 'poza.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      ['a file without extension', 'curs', txt(SAMPLE_TEXT)],
      ['a double extension', 'curs.txt.exe', txt(SAMPLE_TEXT)],
    ])(
      'refuses %s with 415 UNSUPPORTED_FILE_FORMAT and names the accepted formats',
      async (_case, fileName, content) => {
        const before = await countDocuments();
        const response = await uploadRequest(ctx.app, user, subjectId, { fileName, content });
        expect(response.statusCode).toBe(415);
        const error = errorOf(response);
        expect(error.code).toBe('UNSUPPORTED_FILE_FORMAT');
        expect(error.message).toMatch(/PDF, DOCX sau TXT/);
        expect(error.details).toEqual({ allowed: ['pdf', 'docx', 'txt'] });
        expect(await countDocuments()).toBe(before);
      },
    );

    it.each([
      ['a .pdf that is not a PDF', 'fals.pdf', txt(SAMPLE_TEXT)],
      ['a .docx that is not a ZIP archive', 'fals.docx', txt(SAMPLE_TEXT)],
      [
        'a .docx that is another kind of archive',
        'fals.docx',
        zip([{ name: 'ppt/presentation.xml', content: '<p/>' }]),
      ],
      [
        'a .txt with binary content',
        'fals.txt',
        Buffer.concat([txt('MZ'), Buffer.alloc(300), txt(SAMPLE_TEXT)]),
      ],
    ])('refuses %s: the content must match the extension', async (_case, fileName, content) => {
      const response = await uploadRequest(ctx.app, user, subjectId, { fileName, content });
      expect(response.statusCode).toBe(415);
      expect(errorOf(response).code).toBe('UNSUPPORTED_FILE_FORMAT');
    });

    it('accepts a PDF whose signature comes after a few stray bytes', async () => {
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'cu-prefix.pdf',
        content: Buffer.concat([Buffer.from('\n\n  '), VALID_PDF.content]),
      });
      expect(response.statusCode).toBe(201);
    });

    it('accepts a UTF-16 text file, although it contains zero bytes', async () => {
      const content = Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from(SAMPLE_TEXT, 'utf16le'),
      ]);
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'utf16.txt',
        content,
      });
      expect(response.statusCode).toBe(201);
    });
  });

  describe('size (M05)', () => {
    afterAll(() => clearSetting(ctx.pool, 'max_file_size_mb'));

    it('refuses a file over the limit with 413 FILE_TOO_LARGE and tells the limits (C-03)', async () => {
      await setSetting(ctx.pool, 'max_file_size_mb', 1);
      const before = await countDocuments();
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'mare.txt',
        content: Buffer.alloc(1024 * 1024 + 1, 'a'),
      });
      expect(response.statusCode).toBe(413);
      const error = errorOf(response);
      expect(error.code).toBe('FILE_TOO_LARGE');
      expect(error.details).toEqual({ exceeded: 'size', limit_mb: 1, limit_pages: 100 });
      expect(await countDocuments()).toBe(before);
    });

    it('accepts a file of exactly the limit', async () => {
      await setSetting(ctx.pool, 'max_file_size_mb', 1);
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'exact.txt',
        content: Buffer.alloc(1024 * 1024, 'a'),
      });
      expect(response.statusCode).toBe(201);
    });

    it('applies a changed limit from the next upload (RF25)', async () => {
      const file = { fileName: 'doi-mega.txt', content: Buffer.alloc(2 * 1024 * 1024, 'a') };
      await setSetting(ctx.pool, 'max_file_size_mb', 1);
      expect((await uploadRequest(ctx.app, user, subjectId, file)).statusCode).toBe(413);
      await setSetting(ctx.pool, 'max_file_size_mb', 3);
      expect((await uploadRequest(ctx.app, user, subjectId, file)).statusCode).toBe(201);
    });

    it('checks the format before the size: a huge unsupported file is M04, not M05', async () => {
      await setSetting(ctx.pool, 'max_file_size_mb', 1);
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'mare.exe',
        content: Buffer.alloc(2 * 1024 * 1024, 'a'),
      });
      expect(response.statusCode).toBe(415);
    });
  });

  describe('a malformed request', () => {
    it('refuses an empty file with 400', async () => {
      const response = await uploadRequest(ctx.app, user, subjectId, {
        fileName: 'gol.txt',
        content: Buffer.alloc(0),
      });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    });

    it('refuses a request whose file part has another name with 400', async () => {
      const response = await uploadRequest(ctx.app, user, subjectId, VALID_TXT, 'document');
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('VALIDATION_ERROR');
    });

    it('refuses a request that is not multipart with 400', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/subjects/${subjectId}/documents`,
        headers: user.headers,
        payload: { file: 'text' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('a rejected upload leaves nothing behind', () => {
    it('no row and no file, for every kind of rejection', async () => {
      const student = await registerStudent(ctx.app);
      const subject = await createSubject(ctx.app, student);
      const files = ctx.storedFiles().length;
      const rows = await countDocuments();
      await uploadRequest(ctx.app, student, subject, { fileName: 'x.exe', content: txt('x') });
      await uploadRequest(ctx.app, student, subject, {
        fileName: 'gol.txt',
        content: Buffer.alloc(0),
      });
      await uploadRequest(ctx.app, student, subject, { fileName: 'fals.pdf', content: txt('nu') });
      expect(ctx.storedFiles()).toHaveLength(files);
      expect(await countDocuments()).toBe(rows);
    });
  });

  describe('access', () => {
    it('answers 404 for a subject that does not exist or belongs to someone else', async () => {
      const other = await registerStudent(ctx.app);
      expect((await uploadRequest(ctx.app, user, 999_999_999, VALID_TXT)).statusCode).toBe(404);
      const before = await countDocuments();
      expect((await uploadRequest(ctx.app, other, subjectId, VALID_TXT)).statusCode).toBe(404);
      expect(await countDocuments()).toBe(before);
    });

    it('needs a student session', async () => {
      const body = { method: 'POST' as const, url: `/api/v1/subjects/${subjectId}/documents` };
      expect((await ctx.app.inject(body)).statusCode).toBe(401);
      const admin = await registerAdmin(ctx.app, ctx.pool);
      expect((await uploadRequest(ctx.app, admin, subjectId, VALID_TXT)).statusCode).toBe(403);
    });
  });

  it('the stored row matches the response and waits in the queue', async () => {
    const response = await uploadRequest(ctx.app, user, subjectId, VALID_TXT);
    const row = await documentRow(ctx.pool, response.json().id);
    expect(row).toMatchObject({
      file_name: 'curs.txt',
      format: 'txt',
      status: 'queued',
      error_reason: null,
      page_count: null,
      processing_started_at: null,
      deleted_at: null,
    });
    expect(Number(row!.size_bytes)).toBe(VALID_TXT.content.length);
  });
});
