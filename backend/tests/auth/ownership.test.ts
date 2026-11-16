import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOwnedResources,
  describeOwnership,
  requestWithIds,
  withOwnerIds,
} from '../helpers/authorization.js';
import { buildAuthTestApp } from '../helpers/auth-app.js';
import type { AuthTestApp } from '../helpers/auth-app.js';
import { loadOperations } from '../helpers/openapi.js';
import { registerStudent } from '../helpers/session.js';

/**
 * RNF7: a student reaches only their own data. The suite itself lives in
 * tests/helpers/authorization.ts and walks every student route of the contract; routes that
 * still answer 501 are skipped until their segment implements them.
 *
 * EVERY segment keeps this file passing. A segment that adds a new kind of identifier
 * extends the helper, not this file.
 */
let ctx: AuthTestApp;
beforeAll(async () => void (ctx = await buildAuthTestApp()));
afterAll(() => ctx.close());

describeOwnership(() => ({ app: ctx.app, pool: ctx.pool }));

describe('the ownership helper itself', () => {
  it('creates one resource of every kind for an existing user', async () => {
    const user = await registerStudent(ctx.app);
    const ids = await createOwnedResources(ctx.pool, user.id);
    expect(Object.keys(ids).sort()).toEqual(
      ['concept_id', 'document_id', 'material_id', 'passage_id', 'subject_id', 'test_id'].sort(),
    );
    const { rows } = await ctx.pool.query(
      `SELECT s.user_id, d.status FROM documents d JOIN subjects s ON s.id = d.subject_id WHERE d.id = $1`,
      [ids.document_id],
    );
    expect(rows[0]).toEqual({ user_id: String(user.id), status: 'ready' });
  });

  it('puts the owner’s identifiers in the path, the query and the body of a request', async () => {
    const user = await registerStudent(ctx.app);
    const intruder = await registerStudent(ctx.app);
    const ids = await createOwnedResources(ctx.pool, user.id);
    const operations = loadOperations();
    const find = (operationId: string) => operations.find((o) => o.op.operationId === operationId)!;

    expect(requestWithIds(find('getDocument'), ids, intruder).url).toBe(
      `/api/v1/documents/${ids.document_id}`,
    );
    expect(requestWithIds(find('listDocuments'), ids, intruder, { query: true }).query).toEqual({
      subject_id: String(ids.subject_id),
    });
    expect(requestWithIds(find('generateMaterials'), ids, intruder).payload).toMatchObject({
      document_id: ids.document_id,
      concept_ids: [ids.concept_id],
    });
    expect(withOwnerIds({ nested: { material_id: 1, passage_ids: [1, 2] } }, ids)).toEqual({
      nested: { material_id: ids.material_id, passage_ids: [ids.passage_id] },
    });
  });
});
