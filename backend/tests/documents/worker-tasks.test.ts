import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentsWorkerTasks } from '../../src/modules/documents/service.js';
import {
  buildDocumentsTestApp,
  createSubject,
  documentRow,
  upload,
} from '../helpers/documents-app.js';
import type { DocumentsTestApp } from '../helpers/documents-app.js';
import { registerStudent } from '../helpers/session.js';

/** The background tasks of the module (ADR-0003). Design: section 9. */
describe('documents worker tasks', () => {
  let ctx: DocumentsTestApp;

  beforeAll(async () => {
    ctx = await buildDocumentsTestApp();
    await ctx.pool.query(`DELETE FROM documents WHERE status IN ('queued', 'processing')`);
  });
  afterAll(() => ctx.close());

  const signal = () => new AbortController().signal;
  const task = (name: string) => {
    const found = documentsWorkerTasks(ctx.app.documents).find((t) => t.name === name);
    if (!found) throw new Error(`no worker task named ${name}`);
    return found;
  };

  it('registers the four tasks with their intervals', () => {
    const tasks = documentsWorkerTasks(ctx.app.documents);
    expect(Object.fromEntries(tasks.map((t) => [t.name, t.intervalMs]))).toEqual({
      'documents:process-queue': 1000,
      'documents:fail-stuck': 10_000,
      'documents:purge-deleted': 3_600_000,
      'documents:remove-orphan-files': 86_400_000,
    });
  });

  it('process-queue empties the queue in one run', async () => {
    const user = await registerStudent(ctx.app);
    const subjectId = await createSubject(ctx.app, user);
    const ids = [
      await upload(ctx.app, user, subjectId),
      await upload(ctx.app, user, subjectId),
      await upload(ctx.app, user, subjectId),
    ];
    await task('documents:process-queue').run(signal());
    for (const id of ids) expect((await documentRow(ctx.pool, id))!.status).toBe('ready');
  });

  it('process-queue stops taking documents once its signal is aborted', async () => {
    const user = await registerStudent(ctx.app);
    const subjectId = await createSubject(ctx.app, user);
    const id = await upload(ctx.app, user, subjectId);
    const controller = new AbortController();
    controller.abort();
    await task('documents:process-queue').run(controller.signal);
    expect((await documentRow(ctx.pool, id))!.status).toBe('queued');
    await task('documents:process-queue').run(signal());
  });

  it('fail-stuck, purge-deleted and remove-orphan-files run without a queue', async () => {
    await expect(task('documents:fail-stuck').run(signal())).resolves.toBeUndefined();
    await expect(task('documents:purge-deleted').run(signal())).resolves.toBeUndefined();
    await expect(task('documents:remove-orphan-files').run(signal())).resolves.toBeUndefined();
  });
});
