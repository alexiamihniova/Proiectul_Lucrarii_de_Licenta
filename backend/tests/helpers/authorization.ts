import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedOwnedData } from './db.js';
import { fillPath, isUnsafe, label, loadOperations } from './openapi.js';
import type { ApiOperation } from './openapi.js';
import { BODIES } from './sample-bodies.js';
import { registerStudent } from './session.js';
import type { TestUser } from './session.js';

/**
 * OWNERSHIP SUITE — RNF7: "a student sees only their own data" (docs/design/auth.md, 6.3).
 *
 * It does not rely on anyone remembering to write a test for a new endpoint. It walks the
 * contract (docs/openapi.json) and, for EVERY student route:
 *
 *   1. creates a full set of resources owned by student A, directly in the database;
 *   2. calls the route as student B with A's identifiers — in the path, in the query string
 *      and in the request body;
 *   3. expects `404 NOT_FOUND` (never 200, never 403: B must not learn the resource exists);
 *   4. checks that none of A's rows changed.
 *
 * Routes that still answer 501 are skipped and join the suite automatically on the day their
 * segment implements them.
 *
 * WHAT A SEGMENT HAS TO DO
 *   - Nothing, for routes whose identifiers are already known below.
 *   - When it adds a route with a NEW kind of identifier (a new `{something_id}` path
 *     parameter, or a new `something_id` field in a body), the completeness test fails until
 *     the identifier is added to `OwnedIds` and created in `createOwnedResources`.
 *   - For data scoped by the session alone (no identifier: /progress/…, /reviews/…,
 *     /preferences), write the check by hand with `twoStudents()`: A has data, B asks, B gets
 *     nothing of A's.
 *
 * USE
 *   describeOwnership(() => ({ app, pool }));      // inside any test file, after building the app
 */

/** Identifiers of one student's resources, keyed exactly like the API names them. */
export interface OwnedIds {
  subject_id: number;
  document_id: number;
  passage_id: number;
  concept_id: number;
  material_id: number;
  test_id: number;
}

/** Fields that carry a LIST of identifiers → the single-identifier key they come from. */
const LIST_FIELDS: Record<string, keyof OwnedIds> = {
  concept_ids: 'concept_id',
  passage_ids: 'passage_id',
  material_ids: 'material_id',
};

/** Identifier-like names that are deliberately NOT owned resources. Justify every entry. */
const NOT_OWNED = new Set([
  'source_concept_id', // mergeConcepts: also replaced below, with the owner's concept
]);

const OWNED_KEYS: (keyof OwnedIds)[] = [
  'subject_id',
  'document_id',
  'passage_id',
  'concept_id',
  'material_id',
  'test_id',
];

/** Creates, in the database, one resource of every kind for an existing user. */
export async function createOwnedResources(pool: pg.Pool, userId: number): Promise<OwnedIds> {
  const ids = await seedOwnedData(pool, userId);
  // A document must be `ready` for its passages, concepts and materials to be served.
  await pool.query(
    `UPDATE documents SET status = 'processing', processing_started_at = now() WHERE id = $1`,
    [ids.documentId],
  );
  await pool.query(`UPDATE documents SET status = 'ready', page_count = 1 WHERE id = $1`, [
    ids.documentId,
  ]);
  return {
    subject_id: ids.subjectId,
    document_id: ids.documentId,
    passage_id: ids.passageId,
    concept_id: ids.conceptId,
    material_id: ids.materialId,
    test_id: ids.testId,
  };
}

const TABLE_OF: Record<keyof OwnedIds, string> = {
  subject_id: 'subjects',
  document_id: 'documents',
  passage_id: 'passages',
  concept_id: 'concepts',
  material_id: 'materials',
  test_id: 'tests',
};

/** Everything A owns, as stored. Compared before and after B's request. */
export async function snapshot(pool: pg.Pool, userId: number, ids: OwnedIds): Promise<string> {
  const parts: unknown[] = [];
  for (const key of OWNED_KEYS) {
    const { rows } = await pool.query(`SELECT * FROM ${TABLE_OF[key]} WHERE id = $1`, [ids[key]]);
    parts.push({ table: TABLE_OF[key], rows });
  }
  for (const table of ['answers', 'material_reports', 'concept_passages']) {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    parts.push({ table, count: rows[0].n });
  }
  for (const table of ['concept_progress', 'reviews', 'preferences']) {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE user_id = $1`, [userId]);
    parts.push({ table, rows });
  }
  return JSON.stringify(parts);
}

/** Replaces every identifier in a sample body with the owner's. */
export function withOwnerIds(value: unknown, ids: OwnedIds): unknown {
  if (Array.isArray(value)) return value.map((item) => withOwnerIds(item, ids));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      if (key in ids) return [key, ids[key as keyof OwnedIds]];
      if (key in LIST_FIELDS) return [key, [ids[LIST_FIELDS[key]!]]];
      if (key === 'source_concept_id') return [key, ids.concept_id];
      return [key, withOwnerIds(inner, ids)];
    }),
  );
}

function identifierFields(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => identifierFields(item, found));
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (/_ids?$/.test(key)) found.add(key);
      identifierFields(inner, found);
    }
  }
  return found;
}

const MULTIPART_BOUNDARY = 'ownership';
const MULTIPART_FILE =
  `--${MULTIPART_BOUNDARY}\r\ncontent-disposition: form-data; name="file"; filename="a.txt"\r\n` +
  `content-type: text/plain\r\n\r\nhello\r\n--${MULTIPART_BOUNDARY}--\r\n`;

/** The request B sends: A's identifiers everywhere an identifier can go. */
export function requestWithIds(
  operation: ApiOperation,
  ids: OwnedIds,
  intruder: TestUser,
  options: { query?: boolean } = {},
): InjectOptions {
  const url = fillPath(operation.path, (name) => ids[name as keyof OwnedIds]);
  const query = options.query
    ? Object.fromEntries(
        operation.queryParams
          .filter((name) => name in ids)
          .map((name) => [name, String(ids[name as keyof OwnedIds])]),
      )
    : undefined;
  const request: InjectOptions = {
    method: operation.method,
    url,
    headers: { ...intruder.headers },
  };
  if (query && Object.keys(query).length > 0) request.query = query;
  if (operation.op.operationId === 'uploadDocument') {
    request.headers = {
      ...intruder.headers,
      'content-type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
    };
    request.payload = MULTIPART_FILE;
  } else if (isUnsafe(operation) && BODIES[operation.op.operationId] !== undefined) {
    request.payload = withOwnerIds(BODIES[operation.op.operationId], ids) as object;
  }
  return request;
}

const studentOperations = loadOperations().filter((operation) => operation.access === 'student');

/** Routes that name a resource in the path. */
const byPath = studentOperations.filter((operation) => operation.pathParams.length > 0);

/** Routes that name a resource only in the body. */
const byBody = studentOperations.filter(
  (operation) =>
    operation.pathParams.length === 0 &&
    isUnsafe(operation) &&
    [...identifierFields(BODIES[operation.op.operationId])].length > 0,
);

/** Collections: no path parameter, GET, paginated. */
const collections = studentOperations.filter(
  (operation) =>
    operation.method === 'GET' &&
    operation.pathParams.length === 0 &&
    operation.queryParams.includes('page_size'),
);

export interface OwnershipContext {
  app: FastifyInstance;
  pool: pg.Pool;
}

/** Two fresh students; A owns one resource of every kind, B owns nothing. */
export async function twoStudents(context: OwnershipContext) {
  const owner = await registerStudent(context.app);
  const intruder = await registerStudent(context.app);
  const ids = await createOwnedResources(context.pool, owner.id);
  return { owner, intruder, ids };
}

function expectNotFound(response: LightMyRequestResponse, what: string): void {
  expect(response.statusCode, `${what} → ${response.statusCode} ${response.body}`).toBe(404);
  expect((response.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
}

export function describeOwnership(getContext: () => OwnershipContext): void {
  describe('ownership: a student cannot reach another student’s data (RNF7)', () => {
    let owner: TestUser;
    let intruder: TestUser;
    let ids: OwnedIds;

    beforeAll(async () => {
      ({ owner, intruder, ids } = await twoStudents(getContext()));
    });

    afterAll(async () => {
      const { pool } = getContext();
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [[owner?.id, intruder?.id]]);
    });

    it('knows how to create every kind of resource a student route can name', () => {
      const unknown = new Set<string>();
      for (const operation of studentOperations) {
        for (const name of operation.pathParams) if (!(name in TABLE_OF)) unknown.add(name);
        for (const name of operation.queryParams) {
          if (/_ids?$/.test(name) && !(name in TABLE_OF) && !(name in LIST_FIELDS))
            unknown.add(name);
        }
        for (const name of identifierFields(BODIES[operation.op.operationId])) {
          if (!(name in TABLE_OF) && !(name in LIST_FIELDS) && !NOT_OWNED.has(name))
            unknown.add(name);
        }
      }
      expect(
        [...unknown],
        'new identifier(s): add them to OwnedIds and createOwnedResources in tests/helpers/authorization.ts',
      ).toEqual([]);
    });

    it('covers every student route that names a resource', () => {
      expect(byPath.length).toBeGreaterThanOrEqual(20);
      expect(byBody.map((operation) => operation.op.operationId).sort()).toEqual(
        expect.arrayContaining([
          'answerReview',
          'createConcept',
          'createTest',
          'generateMaterials',
        ]),
      );
      expect(collections.length).toBeGreaterThanOrEqual(5);
    });

    it.each(byPath.map((operation) => [label(operation), operation] as const))(
      'path: %s answers 404 to another student and changes nothing',
      async (_label, operation) => {
        const { app, pool } = getContext();
        const before = await snapshot(pool, owner.id, ids);
        const response = await app.inject(requestWithIds(operation, ids, intruder));
        if (response.statusCode === 501) return expect(response.statusCode).toBe(501); // not built yet
        expectNotFound(response, label(operation));
        expect(await snapshot(pool, owner.id, ids), 'the owner’s data changed').toBe(before);
      },
    );

    it.each(byBody.map((operation) => [label(operation), operation] as const))(
      'body: %s answers 404 when the body names another student’s resource',
      async (_label, operation) => {
        const { app, pool } = getContext();
        const before = await snapshot(pool, owner.id, ids);
        const response = await app.inject(requestWithIds(operation, ids, intruder));
        if (response.statusCode === 501) return expect(response.statusCode).toBe(501);
        expectNotFound(response, label(operation));
        expect(await snapshot(pool, owner.id, ids), 'the owner’s data changed').toBe(before);
      },
    );

    it.each(collections.map((operation) => [label(operation), operation] as const))(
      'list: %s shows another student nothing',
      async (_label, operation) => {
        const { app } = getContext();

        const plain = await app.inject(requestWithIds(operation, ids, intruder));
        if (plain.statusCode === 501) return expect(plain.statusCode).toBe(501);
        expect(plain.statusCode, plain.body).toBe(200);
        expect(plain.json()).toMatchObject({ items: [], total: 0 });

        // Filtering by the owner's identifiers must not open a way in either.
        const filtered = await app.inject(
          requestWithIds(operation, ids, intruder, { query: true }),
        );
        if (filtered.statusCode === 404) return expectNotFound(filtered, label(operation));
        expect(filtered.statusCode, filtered.body).toBe(200);
        expect(filtered.json()).toMatchObject({ items: [], total: 0 });
      },
    );

    it.each(
      byPath
        .filter((operation) => operation.method === 'GET')
        .map((operation) => [label(operation), operation] as const),
    )('sanity: %s is reachable by its owner', async (_label, operation) => {
      // The file of a document created directly in the database does not exist on disk.
      if (operation.op.operationId === 'downloadDocumentFile') return;
      const { app } = getContext();
      const response = await app.inject(requestWithIds(operation, ids, owner));
      if (response.statusCode === 501) return expect(response.statusCode).toBe(501);
      // If the owner were refused too, the 404 seen by the intruder would prove nothing.
      // (409 is fine: e.g. the result of a test that is not finished.)
      expect([401, 403, 404], `${label(operation)} → ${response.body}`).not.toContain(
        response.statusCode,
      );
    });
  });
}
