import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SAMPLE_TEXT,
  backdateDeletedDocument,
  buildDocumentsTestApp,
  createSubject,
  documentRow,
  readyDocument,
  upload,
  uploadRequest,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { asciiProse, pdf, txt, wrap } from '../helpers/fixtures.js';
import { DEFAULT_PASSWORD, registerAdmin, registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';
import { actorFromUser } from '../../src/core/actor.js';

/**
 * Files on disk — design section 8 — and the obligation left by Segment 1: the files of a
 * deleted account are removed (RF20, Q43; docs/design/auth-checklist.md, section G).
 */
describe('uploaded files on disk (RF20, Q43)', () => {
  let ctx: DocumentsTestApp;

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
  });
  afterAll(() => ctx.close());

  const student = async () => {
    const user = await registerStudent(ctx.app);
    return { user, subjectId: await createSubject(ctx.app, user) };
  };
  const filesOf = (user: TestUser) =>
    ctx.storedFiles().filter((path) => path.startsWith(`${user.id}/`));
  const remove = (user: TestUser, url: string) =>
    ctx.app.inject({ method: 'DELETE', url: `/api/v1${url}`, headers: user.headers });
  const old = (relative: string) => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
    utimesSync(join(ctx.uploadDir, relative), twoHoursAgo, twoHoursAgo);
  };

  describe('layout', () => {
    it('a file is stored as <user id>/<document id>.<format>, with the uploaded bytes', async () => {
      const { user, subjectId } = await student();
      const content = pdf([wrap(asciiProse(3))]);
      const id = await upload(ctx.app, user, subjectId, { fileName: 'Curs.PDF', content });
      expect(filesOf(user)).toEqual([`${user.id}/${id}.pdf`]);
      expect(readFileSync(join(ctx.uploadDir, `${user.id}/${id}.pdf`)).equals(content)).toBe(true);
    });

    it('the name given by the user never reaches the file system', async () => {
      const { user, subjectId } = await student();
      const before = ctx.storedFiles().length;
      for (const fileName of [
        '../../evadare.txt',
        '..\\..\\evadare.txt',
        '/etc/cron.d/rau.txt',
        'a/b/c.txt',
        '.ascuns.txt',
      ]) {
        const response = await uploadRequest(ctx.app, user, subjectId, {
          fileName,
          content: txt(SAMPLE_TEXT),
        });
        expect(response.statusCode, fileName).toBe(201);
      }
      const mine = filesOf(user);
      expect(mine).toHaveLength(5);
      expect(ctx.storedFiles()).toHaveLength(before + 5);
      for (const path of mine) expect(path).toMatch(new RegExp(`^${user.id}/\\d+\\.txt$`));
    });

    it('renaming a document does not rename its file', async () => {
      const { user, subjectId } = await student();
      const id = await upload(ctx.app, user, subjectId);
      await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${id}`,
        headers: user.headers,
        payload: { file_name: '../alt nume.pdf' },
      });
      expect(filesOf(user)).toEqual([`${user.id}/${id}.txt`]);
    });
  });

  describe('deleting', () => {
    it('deleting a document removes its file and only that one', async () => {
      const { user, subjectId } = await student();
      const kept = await readyDocument(ctx, user, subjectId);
      const removed = await readyDocument(ctx, user, subjectId);
      expect((await remove(user, `/documents/${removed}`)).statusCode).toBe(204);
      expect(filesOf(user)).toEqual([`${user.id}/${kept}.txt`]);
    });

    it('deleting a subject removes the files of all its documents, and no other', async () => {
      const { user, subjectId } = await student();
      const other = await createSubject(ctx.app, user);
      await upload(ctx.app, user, subjectId);
      await upload(ctx.app, user, subjectId);
      const kept = await upload(ctx.app, user, other);
      expect(filesOf(user)).toHaveLength(3);
      expect((await remove(user, `/subjects/${subjectId}`)).statusCode).toBe(204);
      expect(filesOf(user)).toEqual([`${user.id}/${kept}.txt`]);
    });

    it('a file that is already gone does not make the deletion fail', async () => {
      const { user, subjectId } = await student();
      const id = await upload(ctx.app, user, subjectId);
      const { rmSync } = await import('node:fs');
      rmSync(join(ctx.uploadDir, `${user.id}/${id}.txt`));
      expect((await remove(user, `/documents/${id}`)).statusCode).toBe(204);
      expect((await documentRow(ctx.pool, id))!.status).toBe('deleted');
    });

    it('downloading a document whose file is missing answers 404 and logs an error without the file name', async () => {
      const { user, subjectId } = await student();
      const id = await upload(ctx.app, user, subjectId, {
        fileName: 'nume-secret.txt',
        content: txt(SAMPLE_TEXT),
      });
      const { rmSync } = await import('node:fs');
      rmSync(join(ctx.uploadDir, `${user.id}/${id}.txt`));
      const mark = ctx.logs.length;
      const response = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/documents/${id}/file`,
        headers: user.headers,
      });
      expect(response.statusCode).toBe(404);
      const lines = ctx.logs.slice(mark).join('\n');
      expect(lines).toMatch(/"level":50/);
      expect(lines).not.toContain('nume-secret');
    });
  });

  describe('Q43: the files of a deleted account', () => {
    it('deleting the account removes every file of the student, and nobody else’s', async () => {
      const { user, subjectId } = await student();
      const neighbour = await student();
      const second = await createSubject(ctx.app, user);
      await readyDocument(ctx, user, subjectId);
      await upload(ctx.app, user, second);
      const theirs = await upload(ctx.app, neighbour.user, neighbour.subjectId);
      expect(filesOf(user)).toHaveLength(2);

      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/account/delete',
        headers: user.headers,
        payload: { password: DEFAULT_PASSWORD },
      });
      expect(response.statusCode).toBe(204);

      expect(filesOf(user)).toEqual([]);
      expect(existsSync(join(ctx.uploadDir, String(user.id)))).toBe(false);
      expect(filesOf(neighbour.user)).toEqual([`${neighbour.user.id}/${theirs}.txt`]);
    });

    it('no warning about files not being removed is logged any more', async () => {
      const { user, subjectId } = await student();
      await upload(ctx.app, user, subjectId);
      const mark = ctx.logs.length;
      await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/account/delete',
        headers: user.headers,
        payload: { password: DEFAULT_PASSWORD },
      });
      expect(ctx.logs.slice(mark).join('\n')).not.toMatch(/NOT removed|no file store/i);
    });

    it('an administrator deleting the account removes the files too (RF21)', async () => {
      const { user, subjectId } = await student();
      await upload(ctx.app, user, subjectId);
      const admin = await registerAdmin(ctx.app, ctx.pool);
      await ctx.app.auth.deleteUser(actorFromUser({ id: admin.id, role: 'admin' }), user.id);
      expect(filesOf(user)).toEqual([]);
    });

    it('userFiles.deleteAllForUser is idempotent and leaves the other directories alone', async () => {
      const { user, subjectId } = await student();
      const neighbour = await student();
      await upload(ctx.app, user, subjectId);
      await upload(ctx.app, neighbour.user, neighbour.subjectId);
      await ctx.app.documents.userFiles.deleteAllForUser(user.id);
      await ctx.app.documents.userFiles.deleteAllForUser(user.id); // nothing left: still succeeds
      await ctx.app.documents.userFiles.deleteAllForUser(987_654_321); // never had files
      expect(filesOf(user)).toEqual([]);
      expect(filesOf(neighbour.user)).toHaveLength(1);
    });

    it.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
      'userFiles.deleteAllForUser refuses %s as a user id and deletes nothing',
      async (userId) => {
        const { user, subjectId } = await student();
        await upload(ctx.app, user, subjectId);
        const before = ctx.storedFiles();
        await expect(ctx.app.documents.userFiles.deleteAllForUser(userId)).rejects.toBeDefined();
        expect(ctx.storedFiles()).toEqual(before);
      },
    );
  });

  describe('orphan files (design 8)', () => {
    it('removeOrphanFiles deletes old files without a live document and keeps the rest', async () => {
      const { user, subjectId } = await student();
      const live = await upload(ctx.app, user, subjectId);
      const directory = join(ctx.uploadDir, String(user.id));
      writeFileSync(join(directory, '999999001.txt'), 'orfan vechi');
      writeFileSync(join(directory, '999999002.txt'), 'orfan nou');
      old(`${user.id}/999999001.txt`);
      old(`${user.id}/${live}.txt`); // old but live: must stay

      expect(await ctx.app.documents.removeOrphanFiles()).toBeGreaterThanOrEqual(1);
      expect(filesOf(user).sort()).toEqual(
        [`${user.id}/${live}.txt`, `${user.id}/999999002.txt`].sort(),
      );
    });

    it('removes the old file of a deleted document that was left behind', async () => {
      const { user, subjectId } = await student();
      const id = await upload(ctx.app, user, subjectId);
      await remove(user, `/documents/${id}`);
      // Simulate a crash between COMMIT and the removal of the file.
      mkdirSync(join(ctx.uploadDir, String(user.id)), { recursive: true });
      writeFileSync(join(ctx.uploadDir, `${user.id}/${id}.txt`), 'rămas după cădere');
      old(`${user.id}/${id}.txt`);
      await ctx.app.documents.removeOrphanFiles();
      expect(filesOf(user)).toEqual([]);
    });

    it('removes the directory of a user who no longer exists', async () => {
      const directory = join(ctx.uploadDir, '987654000');
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, '1.txt'), 'al nimănui');
      old('987654000/1.txt');
      await ctx.app.documents.removeOrphanFiles();
      expect(existsSync(directory)).toBe(false);
    });
  });

  describe('soft-deleted rows (Q12)', () => {
    it('purgeDeletedDocuments removes rows deleted more than 48 hours ago, and only those', async () => {
      const { user, subjectId } = await student();
      const longAgo = await upload(ctx.app, user, subjectId);
      const recent = await upload(ctx.app, user, subjectId);
      const live = await upload(ctx.app, user, subjectId);
      await remove(user, `/documents/${longAgo}`);
      await remove(user, `/documents/${recent}`);
      await backdateDeletedDocument(ctx.pool, longAgo, 49);

      expect(await ctx.app.documents.purgeDeletedDocuments()).toBeGreaterThanOrEqual(1);
      expect(await documentRow(ctx.pool, longAgo)).toBeUndefined();
      expect((await documentRow(ctx.pool, recent))!.status).toBe('deleted');
      expect((await documentRow(ctx.pool, live))!.status).toBe('queued');
    });

    it('follows DELETED_DOCUMENT_RETENTION_HOURS', async () => {
      const short = await buildDocumentsTestApp({ DELETED_DOCUMENT_RETENTION_HOURS: '1' });
      try {
        const user = await registerStudent(short.app);
        const subjectId = await createSubject(short.app, user);
        const id = await upload(short.app, user, subjectId);
        await short.app.inject({
          method: 'DELETE',
          url: `/api/v1/documents/${id}`,
          headers: user.headers,
        });
        await backdateDeletedDocument(short.pool, id, 2);
        await short.app.documents.purgeDeletedDocuments();
        expect(await documentRow(short.pool, id)).toBeUndefined();
      } finally {
        await short.close();
      }
    });
  });
});
