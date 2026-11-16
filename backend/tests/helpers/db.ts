import pg from 'pg';
import { testDatabaseUrl } from './env.js';

/** Raw SQL access for constraint tests: they must see exactly what PostgreSQL enforces. */
export function createTestPool(): pg.Pool {
  return new pg.Pool({ connectionString: testDatabaseUrl(), max: 2 });
}

export const TABLES = [
  'users',
  'preferences',
  'password_reset_tokens',
  'subjects',
  'documents',
  'passages',
  'concepts',
  'concept_passages',
  'materials',
  'tests',
  'answers',
  'concept_progress',
  'reviews',
  'material_reports',
  'llm_calls',
  'settings',
] as const;

export async function truncateAll(pool: pg.Pool): Promise<void> {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

type Row = Record<string, unknown>;

async function insert(pool: pg.Pool, table: string, values: Row): Promise<Row> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const result = await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    Object.values(values),
  );
  return result.rows[0] as Row;
}

let counter = 0;

/** Row factories with valid defaults; pass overrides to break exactly one rule per test. */
export function factories(pool: pg.Pool) {
  const id = (row: Row) => Number(row.id);
  return {
    insert: (table: string, values: Row) => insert(pool, table, values),

    async user(overrides: Row = {}): Promise<number> {
      counter += 1;
      return id(
        await insert(pool, 'users', {
          email: `student${counter}@example.com`,
          password_hash: 'hash',
          gdpr_consent_at: new Date(),
          gdpr_consent_version: '1',
          ...overrides,
        }),
      );
    },

    async subject(userId: number, overrides: Row = {}): Promise<number> {
      counter += 1;
      return id(
        await insert(pool, 'subjects', {
          user_id: userId,
          name: `Materie ${counter}`,
          ...overrides,
        }),
      );
    },

    async document(subjectId: number, overrides: Row = {}): Promise<number> {
      return id(
        await insert(pool, 'documents', {
          subject_id: subjectId,
          file_name: 'curs.pdf',
          format: 'pdf',
          size_bytes: 1024,
          ...overrides,
        }),
      );
    },

    async passage(documentId: number, overrides: Row = {}): Promise<number> {
      counter += 1;
      return id(
        await insert(pool, 'passages', {
          document_id: documentId,
          position: counter,
          page: 1,
          start_offset: 0,
          end_offset: 10,
          text: 'Cheia primară identifică unic un rând.',
          ...overrides,
        }),
      );
    },

    async concept(subjectId: number, overrides: Row = {}): Promise<number> {
      return id(
        await insert(pool, 'concepts', {
          subject_id: subjectId,
          name: 'Cheie primară',
          definition: 'Identifică unic un rând.',
          origin: 'model',
          ...overrides,
        }),
      );
    },

    async material(conceptId: number, passageId: number, overrides: Row = {}): Promise<number> {
      return id(
        await insert(pool, 'materials', {
          concept_id: conceptId,
          passage_id: passageId,
          type: 'flashcard',
          statement: 'Ce este cheia primară?',
          correct_answer: 'Identifică unic un rând.',
          quote: 'identifică unic un rând',
          source_verified: true,
          ...overrides,
        }),
      );
    },

    async test(userId: number, subjectId: number, overrides: Row = {}): Promise<number> {
      return id(
        await insert(pool, 'tests', {
          user_id: userId,
          subject_id: subjectId,
          config: JSON.stringify({ question_count: 5 }),
          ...overrides,
        }),
      );
    },
  };
}

/** A whole student graph: a new user plus one row in every table that hangs off them. */
export async function seedGraph(pool: pg.Pool) {
  const f = factories(pool);
  const userId = await f.user();
  await f.insert('preferences', { user_id: userId });
  await f.insert('password_reset_tokens', {
    user_id: userId,
    token_hash: `hash-${userId}`,
    expires_at: new Date(Date.now() + 3_600_000),
  });
  return seedOwnedData(pool, userId);
}

/**
 * Study data for an EXISTING user (for example one registered through the API): one row in
 * every table below `subjects`, plus a model call. Returns the ids.
 */
export async function seedOwnedData(pool: pg.Pool, userId: number) {
  const f = factories(pool);
  const subjectId = await f.subject(userId);
  const documentId = await f.document(subjectId);
  const passageId = await f.passage(documentId);
  const conceptId = await f.concept(subjectId);
  await f.insert('concept_passages', { concept_id: conceptId, passage_id: passageId });
  const materialId = await f.material(conceptId, passageId);
  const testId = await f.test(userId, subjectId);
  await f.insert('answers', {
    test_id: testId,
    material_id: materialId,
    given_answer: 'x',
    score: 1,
    quality: 5,
  });
  await f.insert('answers', { material_id: materialId, given_answer: 'y', score: 0.5, quality: 3 });
  await f.insert('concept_progress', {
    user_id: userId,
    concept_id: conceptId,
    mastery: 80,
    status: 'in_progress',
  });
  await f.insert('reviews', { user_id: userId, concept_id: conceptId, due_date: '2026-11-13' });
  await f.insert('material_reports', {
    material_id: materialId,
    user_id: userId,
    reason: 'Răspuns greșit',
  });
  await f.insert('llm_calls', {
    user_id: userId,
    document_id: documentId,
    operation: 'extract_concepts',
    status: 'success',
    duration_ms: 1200,
  });
  return { userId, subjectId, documentId, passageId, conceptId, materialId, testId };
}

export async function count(pool: pg.Pool, table: string): Promise<number> {
  const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return result.rows[0]!.n;
}
