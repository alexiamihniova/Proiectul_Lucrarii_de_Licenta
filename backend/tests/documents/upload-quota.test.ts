import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/auth-app.js';
import {
  buildDocumentsTestApp,
  clearSetting,
  createSubject,
  setSetting,
  upload,
  uploadRequest,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { txt } from '../helpers/fixtures.js';
import { registerStudent } from '../helpers/session.js';
import type { TestUser } from '../helpers/session.js';

/** UC-04 — daily upload limit: SRS 3.2.4.1, P6, M08, C-07 (EV16). Design: section 2.4. */
describe('daily upload limit (C-07, M08)', () => {
  let ctx: DocumentsTestApp;
  const FILE = { fileName: 'curs.txt', content: txt('text '.repeat(100)) };

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    await setSetting(ctx.pool, 'uploads_per_day', 3);
  });
  afterAll(async () => {
    await clearSetting(ctx.pool, 'uploads_per_day');
    await ctx.close();
  });

  const quota = async (who: TestUser) =>
    (
      await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/documents/upload-quota',
        headers: who.headers,
      })
    ).json();

  const fresh = async () => {
    const user = await registerStudent(ctx.app);
    return { user, subjectId: await createSubject(ctx.app, user) };
  };

  it('a new student has the whole limit', async () => {
    const { user } = await fresh();
    expect(await quota(user)).toMatchObject({
      limit: 3,
      used: 0,
      remaining: 3,
      max_file_size_mb: 20,
      max_pages: 100,
    });
  });

  it('each accepted upload uses one; the limit shown is what is left (C-07)', async () => {
    const { user, subjectId } = await fresh();
    await upload(ctx.app, user, subjectId, FILE);
    expect(await quota(user)).toMatchObject({ used: 1, remaining: 2 });
    await upload(ctx.app, user, subjectId, FILE);
    expect(await quota(user)).toMatchObject({ used: 2, remaining: 1 });
  });

  it('the upload over the limit answers 429 DAILY_UPLOAD_LIMIT_REACHED with the limit and the reset time', async () => {
    const { user, subjectId } = await fresh();
    for (let i = 0; i < 3; i += 1) await upload(ctx.app, user, subjectId, FILE);
    const response = await uploadRequest(ctx.app, user, subjectId, FILE);
    expect(response.statusCode).toBe(429);
    const error = errorOf(response);
    expect(error.code).toBe('DAILY_UPLOAD_LIMIT_REACHED');
    expect(error.message).toMatch(/limita zilnică/);
    const details = error.details as { limit: number; resets_at: string };
    expect(details.limit).toBe(3);
    expect(details.resets_at).toBe((await quota(user)).resets_at);
    expect(await quota(user)).toMatchObject({ used: 3, remaining: 0 });
  });

  it('a rejected file does not use up the limit', async () => {
    const { user, subjectId } = await fresh();
    await uploadRequest(ctx.app, user, subjectId, { fileName: 'x.exe', content: txt('x') });
    await uploadRequest(ctx.app, user, subjectId, {
      fileName: 'gol.txt',
      content: Buffer.alloc(0),
    });
    expect(await quota(user)).toMatchObject({ used: 0, remaining: 3 });
  });

  it('deleting a document does not give the upload back', async () => {
    const { user, subjectId } = await fresh();
    const id = await upload(ctx.app, user, subjectId, FILE);
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/documents/${id}`,
      headers: user.headers,
    });
    expect(await quota(user)).toMatchObject({ used: 1, remaining: 2 });
  });

  it('reprocessing does not count as an upload', async () => {
    const { user, subjectId } = await fresh();
    const id = await upload(ctx.app, user, subjectId, FILE);
    while (await ctx.app.documents.processNextDocument());
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/reprocess`,
      headers: user.headers,
    });
    expect(await quota(user)).toMatchObject({ used: 1 });
  });

  it('the limit is per student and counts uploads into all their subjects', async () => {
    const { user, subjectId } = await fresh();
    const second = await createSubject(ctx.app, user);
    const other = await fresh();
    await upload(ctx.app, user, subjectId, FILE);
    await upload(ctx.app, user, second, FILE);
    await upload(ctx.app, user, second, FILE);
    expect((await uploadRequest(ctx.app, user, subjectId, FILE)).statusCode).toBe(429);
    expect((await uploadRequest(ctx.app, other.user, other.subjectId, FILE)).statusCode).toBe(201);
  });

  it('yesterday’s uploads do not count: the counter restarts at 00:00 Chișinău time', async () => {
    const { user, subjectId } = await fresh();
    for (let i = 0; i < 3; i += 1) await upload(ctx.app, user, subjectId, FILE);
    // 26 hours ago is always before the last local midnight.
    await ctx.pool.query(
      `UPDATE documents SET uploaded_at = now() - interval '26 hours' WHERE subject_id = $1`,
      [subjectId],
    );
    expect(await quota(user)).toMatchObject({ used: 0, remaining: 3 });
    expect((await uploadRequest(ctx.app, user, subjectId, FILE)).statusCode).toBe(201);
  });

  it('resets_at is the next midnight in Europe/Chisinau, within 25 hours', async () => {
    const { user } = await fresh();
    const { resets_at: resetsAt } = await quota(user);
    const reset = new Date(resetsAt);
    expect(reset.getTime()).toBeGreaterThan(Date.now());
    expect(reset.getTime() - Date.now()).toBeLessThanOrEqual(25 * 3_600_000);
    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Chisinau',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(reset);
    expect(local).toBe('00:00:00');
  });

  it('a changed limit applies from the next upload (RF25)', async () => {
    const { user, subjectId } = await fresh();
    for (let i = 0; i < 3; i += 1) await upload(ctx.app, user, subjectId, FILE);
    await setSetting(ctx.pool, 'uploads_per_day', 4);
    try {
      expect(await quota(user)).toMatchObject({ limit: 4, used: 3, remaining: 1 });
      expect((await uploadRequest(ctx.app, user, subjectId, FILE)).statusCode).toBe(201);
      expect((await uploadRequest(ctx.app, user, subjectId, FILE)).statusCode).toBe(429);
    } finally {
      await setSetting(ctx.pool, 'uploads_per_day', 3);
    }
  });

  it('remaining never goes below zero when the limit is lowered under the uploads made', async () => {
    const { user, subjectId } = await fresh();
    for (let i = 0; i < 3; i += 1) await upload(ctx.app, user, subjectId, FILE);
    await setSetting(ctx.pool, 'uploads_per_day', 1);
    try {
      expect(await quota(user)).toMatchObject({ limit: 1, used: 3, remaining: 0 });
    } finally {
      await setSetting(ctx.pool, 'uploads_per_day', 3);
    }
  });

  it('simultaneous uploads cannot pass the limit: exactly 3 of 6 succeed', async () => {
    const { user, subjectId } = await fresh();
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => uploadRequest(ctx.app, user, subjectId, FILE)),
    );
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 201, 201, 429, 429, 429]);
    expect(await quota(user)).toMatchObject({ used: 3, remaining: 0 });
  });

  it('the quota needs a student session', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/documents/upload-quota' });
    expect(response.statusCode).toBe(401);
  });
});
