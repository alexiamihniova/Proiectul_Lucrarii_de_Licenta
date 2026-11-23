import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/auth-app.js';
import {
  actorOf,
  buildDocumentsTestApp,
  createSubject,
  readyDocument,
  upload,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { asciiProse, pdf, prose, txt, wrap } from '../helpers/fixtures.js';
import { registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';
import { expectValidStructure } from '../helpers/structure.js';

/**
 * RF4, RF5 — passages and the stored structure, as the API and the other modules see them
 * (SRS 3.1.3: passages with identifiers). Design: sections 3, 6 and 7.
 */
describe('passages and structure (RF4, RF5, UC-17)', () => {
  let ctx: DocumentsTestApp;
  let user: TestUser;
  let other: TestUser;
  let subjectId: number;
  let documentId: number;
  let pdfId: number;
  const TEXT = prose(40, 5, 12); // 2400 words → several pages of 3000 characters

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    user = await registerStudent(ctx.app);
    other = await registerStudent(ctx.app);
    subjectId = await createSubject(ctx.app, user);
    documentId = await readyDocument(ctx, user, subjectId, {
      fileName: 'lung.txt',
      content: txt(TEXT),
    });
    pdfId = await readyDocument(ctx, user, subjectId, {
      fileName: 'pagini.pdf',
      content: pdf([
        wrap(asciiProse(4, 5, 12)),
        wrap(asciiProse(4, 5, 13)),
        wrap(asciiProse(4, 5, 14)),
      ]),
    });
  });
  afterAll(() => ctx.close());

  const list = (id: number, query = '', who: TestUser = user) =>
    ctx.app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}/passages${query}`,
      headers: who.headers,
    });

  describe('GET /documents/{id}/passages', () => {
    it('lists the passages in order, with id, page, offsets and text', async () => {
      const body = (await list(documentId, '?page_size=100')).json();
      expect(body.total).toBe(body.items.length);
      expect(body.total).toBeGreaterThan(5);
      for (const [index, passage] of body.items.entries()) {
        expect(passage).toMatchObject({ document_id: documentId, position: index });
        expect(passage.id).toBeGreaterThan(0);
        expect(TEXT.slice(passage.start_offset, passage.end_offset)).toBe(passage.text);
        expect(passage.page).toBe(Math.floor(passage.start_offset / 3000) + 1);
      }
    });

    it('matches the stored structure exactly', async () => {
      const body = (await list(documentId, '?page_size=100')).json();
      const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), documentId);
      expect(
        body.items.map((p: { id: number; text: string; position: number }) => [
          p.id,
          p.position,
          p.text,
        ]),
      ).toEqual(structure.passages.map((p) => [p.id, p.position, p.text]));
    });

    it('paginates in document order', async () => {
      const all = (await list(documentId, '?page_size=100')).json();
      const second = (await list(documentId, '?page=2&page_size=2')).json();
      expect(second).toMatchObject({ total: all.total, page: 2, page_size: 2 });
      expect(second.items.map((p: { position: number }) => p.position)).toEqual([2, 3]);
    });

    it('filters by the page a passage starts on', async () => {
      const all = (await list(pdfId, '?page_size=100')).json();
      const pages = new Set<number>(all.items.map((p: { page: number }) => p.page));
      expect(pages.size).toBeGreaterThan(1);
      for (const page of pages) {
        const filtered = (await list(pdfId, `?page_number=${page}&page_size=100`)).json();
        expect(filtered.items).toEqual(all.items.filter((p: { page: number }) => p.page === page));
        expect(filtered.total).toBe(filtered.items.length);
      }
      expect((await list(pdfId, '?page_number=99')).json()).toMatchObject({ total: 0, items: [] });
    });

    it('answers 409 DOCUMENT_NOT_READY while the document is queued', async () => {
      const queued = await upload(ctx.app, user, subjectId);
      const response = await list(queued);
      expect(response.statusCode).toBe(409);
      expect(errorOf(response).code).toBe('DOCUMENT_NOT_READY');
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/documents/${queued}`,
        headers: user.headers,
      });
    });

    it('answers 404 to another student and for a document that does not exist', async () => {
      expect((await list(documentId, '', other)).statusCode).toBe(404);
      expect((await list(999_999_999)).statusCode).toBe(404);
    });
  });

  describe('what the other modules use (design 7)', () => {
    it('getOwnedDocument returns the document to its owner and NOT_FOUND to anyone else', async () => {
      const document = await ctx.app.documents.getOwnedDocument(actorOf(user), documentId);
      expect(document).toMatchObject({ id: documentId, status: 'ready', subject_id: subjectId });
      await expect(
        ctx.app.documents.getOwnedDocument(actorOf(other), documentId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('getPassagesByIds returns the asked passages in document order', async () => {
      const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), documentId);
      const ids = [structure.passages[3]!.id, structure.passages[0]!.id, structure.passages[2]!.id];
      const passages = await ctx.app.documents.getPassagesByIds(actorOf(user), documentId, ids);
      expect(passages.map((p) => p.position)).toEqual([0, 2, 3]);
      expect(passages[0]).toMatchObject({
        id: structure.passages[0]!.id,
        text: structure.passages[0]!.text,
      });
    });

    it('getPassagesByIds refuses a passage of another document, even of the same student (RB1)', async () => {
      const mine = await ctx.app.documents.getDocumentStructure(actorOf(user), documentId);
      const foreign = await ctx.app.documents.getDocumentStructure(actorOf(user), pdfId);
      await expect(
        ctx.app.documents.getPassagesByIds(actorOf(user), documentId, [
          mine.passages[0]!.id,
          foreign.passages[0]!.id,
        ]),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        ctx.app.documents.getPassagesByIds(actorOf(user), documentId, [999_999_999]),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('getPassagesByIds and getDocumentStructure answer NOT_FOUND to another student', async () => {
      const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), documentId);
      await expect(
        ctx.app.documents.getPassagesByIds(actorOf(other), documentId, [structure.passages[0]!.id]),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        ctx.app.documents.getDocumentStructure(actorOf(other), documentId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('getDocumentStructure gives the canonical text, the sentences and the passages with their ids', async () => {
      const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), documentId);
      expect(structure.documentId).toBe(documentId);
      expect(structure.text).toBe(TEXT);
      expectValidStructure(structure);
      const ids = new Set(structure.passages.map((p) => p.id));
      expect(ids.size).toBe(structure.passages.length);
      for (const sentence of structure.sentences) {
        expect(sentence.passageId).toBe(structure.passages[sentence.passagePosition]!.id);
      }
    });

    it('every sentence is a verbatim quote of its passage (RB1 by construction)', async () => {
      for (const id of [documentId, pdfId]) {
        const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), id);
        for (const sentence of structure.sentences) {
          expect(structure.passages[sentence.passagePosition]!.text).toContain(sentence.text);
        }
      }
    });

    it('a paged document keeps real page numbers on sentences and passages', async () => {
      const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), pdfId);
      expect(structure.pageCount).toBe(3);
      expect(new Set(structure.sentences.map((s) => s.page))).toEqual(new Set([1, 2, 3]));
      expectValidStructure(structure);
    });

    it('getDocumentStructure answers DOCUMENT_NOT_READY before the text is stored', async () => {
      const queued = await upload(ctx.app, user, subjectId);
      await expect(
        ctx.app.documents.getDocumentStructure(actorOf(user), queued),
      ).rejects.toMatchObject({
        code: 'DOCUMENT_NOT_READY',
      });
      expect(await ctx.app.documents.getStructureForAnalysis(queued)).toBeNull();
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/documents/${queued}`,
        headers: user.headers,
      });
    });

    it('the stored rows are the structure: one row per sentence, linked to its passage', async () => {
      const structure = await ctx.app.documents.getDocumentStructure(actorOf(user), documentId);
      const { rows } = await ctx.pool.query(
        `SELECT s.position, s.paragraph, s.page, s.start_offset, s.end_offset, s.text, p.position AS passage_position
         FROM sentences s JOIN passages p ON p.id = s.passage_id
         WHERE s.document_id = $1 ORDER BY s.position`,
        [documentId],
      );
      expect(rows).toHaveLength(structure.sentences.length);
      expect(
        rows.map((r) => [
          r.position,
          r.paragraph,
          r.page,
          r.start_offset,
          r.end_offset,
          r.text,
          r.passage_position,
        ]),
      ).toEqual(
        structure.sentences.map((s) => [
          s.position,
          s.paragraph,
          s.page,
          s.startOffset,
          s.endOffset,
          s.text,
          s.passagePosition,
        ]),
      );
    });
  });
});
