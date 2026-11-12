import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DOCUMENT_STATUSES } from '../src/core/domain.js';
import type { DocumentStatus } from '../src/core/domain.js';
import { AppError } from '../src/core/errors.js';
import {
  DOCUMENT_EVENTS,
  applyUserDocumentEvent,
  nextDocumentStatus,
} from '../src/modules/documents/service.js';
import { createTestPool, factories, truncateAll } from './helpers/db.js';

/**
 * Dosar, Tabelul 3.1 — copied cell by cell. Columns: PP, PR, PE, RP, RD, ȘT. `null` = „—”.
 * This literal is the specification; the code and the database are checked against it.
 */
const SPEC: Record<DocumentStatus, (DocumentStatus | null)[]> = {
  //            PP            PR       PE       RP        RD            ȘT
  queued: ['processing', null, null, null, 'queued', 'deleted'],
  processing: [null, 'ready', 'error', null, 'processing', 'deleted'],
  ready: [null, null, null, 'queued', 'ready', 'deleted'],
  error: [null, null, null, 'queued', 'error', 'deleted'],
  deleted: [null, null, null, null, null, null],
};

const cells = DOCUMENT_STATUSES.flatMap((status) =>
  DOCUMENT_EVENTS.map((event, column) => ({
    status,
    event,
    expected: SPEC[status][column] ?? null,
  })),
);

describe('document state machine — transition table (Dosar, Tabelul 3.1)', () => {
  it('has 5 states × 6 events = 30 cells, 17 of them empty', () => {
    expect(cells).toHaveLength(30);
    expect(cells.filter((cell) => cell.expected === null)).toHaveLength(17);
  });

  it.each(cells)('$status × $event → $expected', ({ status, event, expected }) => {
    expect(nextDocumentStatus(status, event)).toBe(expected);
  });

  it('„Șters” is final: no event leaves it', () => {
    for (const event of DOCUMENT_EVENTS) expect(nextDocumentStatus('deleted', event)).toBeNull();
  });

  it('every active state can be deleted and renamed', () => {
    for (const status of DOCUMENT_STATUSES.filter((s) => s !== 'deleted')) {
      expect(nextDocumentStatus(status, 'deleted')).toBe('deleted');
      expect(nextDocumentStatus(status, 'renamed')).toBe(status);
    }
  });

  it('reprocessing a document that is queued or processing is refused (C-09)', () => {
    for (const status of ['queued', 'processing'] as const) {
      expect(() => applyUserDocumentEvent(status, 'reprocess_requested')).toThrowError(
        expect.objectContaining({ code: 'DOCUMENT_ALREADY_PROCESSING' }),
      );
    }
    expect(applyUserDocumentEvent('ready', 'reprocess_requested')).toBe('queued');
    expect(applyUserDocumentEvent('error', 'reprocess_requested')).toBe('queued');
  });

  it('a deleted document no longer exists for user actions', () => {
    for (const event of ['reprocess_requested', 'renamed', 'deleted'] as const) {
      expect(() => applyUserDocumentEvent('deleted', event)).toThrowError(AppError);
      expect(() => applyUserDocumentEvent('deleted', event)).toThrowError(
        expect.objectContaining({ code: 'NOT_FOUND' }),
      );
    }
  });

  it('late results are dropped: PR on error (C-10) and on deleted (C-08) change nothing', () => {
    expect(nextDocumentStatus('error', 'processing_succeeded')).toBeNull();
    expect(nextDocumentStatus('deleted', 'processing_succeeded')).toBeNull();
  });
});

describe('document state machine — enforced by the database', () => {
  const pool = createTestPool();
  const f = factories(pool);
  let subjectId: number;

  beforeEach(async () => {
    await truncateAll(pool);
    subjectId = await f.subject(await f.user());
  });
  afterAll(() => pool.end());

  /** The UPDATE a service would run to move a document into `status`. */
  const SET: Record<DocumentStatus, string> = {
    queued: `status = 'queued', error_reason = NULL, processing_started_at = NULL`,
    processing: `status = 'processing', processing_started_at = now()`,
    ready: `status = 'ready'`,
    error: `status = 'error', error_reason = 'LLM_UNAVAILABLE'`,
    deleted: `status = 'deleted', deleted_at = now(), error_reason = NULL`,
  };

  /** Shortest legal path from the initial state to each state. */
  const PATH: Record<DocumentStatus, DocumentStatus[]> = {
    queued: [],
    processing: ['processing'],
    ready: ['processing', 'ready'],
    error: ['processing', 'error'],
    deleted: ['deleted'],
  };

  const move = (id: number, to: DocumentStatus) =>
    pool.query(`UPDATE documents SET ${SET[to]} WHERE id = $1`, [id]);

  async function documentIn(status: DocumentStatus): Promise<number> {
    const id = await f.document(subjectId);
    for (const step of PATH[status]) await move(id, step);
    return id;
  }

  async function statusOf(id: number): Promise<string> {
    const { rows } = await pool.query('SELECT status FROM documents WHERE id = $1', [id]);
    return rows[0].status as string;
  }

  /** Status changes the table allows: the non-empty cells whose target differs from the source. */
  const allowed = new Set(
    cells
      .filter((cell) => cell.expected !== null && cell.expected !== cell.status)
      .map((cell) => `${cell.status}>${cell.expected}`),
  );

  const pairs = DOCUMENT_STATUSES.flatMap((from) =>
    DOCUMENT_STATUSES.filter((to) => to !== from).map((to) => ({
      from,
      to,
      ok: allowed.has(`${from}>${to}`),
    })),
  );

  it('the table allows exactly 9 status changes: 5 processing steps and 4 deletions', () => {
    expect([...allowed].sort()).toEqual(
      [
        'queued>processing',
        'processing>ready',
        'processing>error',
        'ready>queued',
        'error>queued',
        'queued>deleted',
        'processing>deleted',
        'ready>deleted',
        'error>deleted',
      ].sort(),
    );
  });

  it.each(pairs)('$from → $to is allowed: $ok', async ({ from, to, ok }) => {
    const id = await documentIn(from);
    if (ok) {
      await move(id, to);
      expect(await statusOf(id)).toBe(to);
    } else {
      await expect(move(id, to)).rejects.toMatchObject({
        code: '23514',
        constraint: 'documents_status_transition',
      });
      expect(await statusOf(id)).toBe(from);
    }
  });

  it('a new document always starts „În coadă”', async () => {
    const id = await f.document(subjectId);
    expect(await statusOf(id)).toBe('queued');
    for (const status of ['processing', 'ready', 'error', 'deleted']) {
      await expect(
        f.document(subjectId, {
          status,
          processing_started_at: new Date(),
          error_reason: status === 'error' ? 'X' : null,
          deleted_at: status === 'deleted' ? new Date() : null,
        }),
      ).rejects.toMatchObject({ constraint: 'documents_status_transition' });
    }
  });

  it.each(['queued', 'processing', 'ready', 'error'] as const)(
    'RD: renaming in state %s keeps the state',
    async (status) => {
      const id = await documentIn(status);
      await pool.query(`UPDATE documents SET file_name = 'nou.pdf' WHERE id = $1`, [id]);
      expect(await statusOf(id)).toBe(status);
    },
  );

  it('a deleted document cannot be changed at all, not even renamed', async () => {
    const id = await documentIn('deleted');
    await expect(
      pool.query(`UPDATE documents SET file_name = 'nou.pdf' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ constraint: 'documents_status_transition' });
  });

  it('a late result after deletion or after an error cannot revive the document (C-08, C-10)', async () => {
    for (const status of ['deleted', 'error'] as const) {
      const id = await documentIn(status);
      await expect(move(id, 'ready')).rejects.toMatchObject({
        constraint: 'documents_status_transition',
      });
    }
  });

  it('the error reason exists exactly in state „Eroare”', async () => {
    const id = await documentIn('processing');
    await expect(
      pool.query(`UPDATE documents SET status = 'error' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ constraint: 'documents_error_reason_check' });
    await expect(
      pool.query(`UPDATE documents SET error_reason = 'X' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ constraint: 'documents_error_reason_check' });
  });

  it('deleted_at exists exactly in state „Șters”; processing needs a start time', async () => {
    const id = await documentIn('ready');
    await expect(
      pool.query(`UPDATE documents SET status = 'deleted' WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ constraint: 'documents_deleted_at_check' });
    await expect(
      pool.query(`UPDATE documents SET deleted_at = now() WHERE id = $1`, [id]),
    ).rejects.toMatchObject({ constraint: 'documents_deleted_at_check' });
    const queued = await documentIn('queued');
    await expect(
      pool.query(`UPDATE documents SET status = 'processing' WHERE id = $1`, [queued]),
    ).rejects.toMatchObject({ constraint: 'documents_processing_started_at_check' });
  });

  it('a soft-deleted document still counts towards the daily upload quota (C-07)', async () => {
    const id = await documentIn('ready');
    await move(id, 'deleted');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM documents WHERE subject_id = $1 AND uploaded_at >= now() - interval '1 day'`,
      [subjectId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('only a worker-claimed row leaves the queue: FOR UPDATE SKIP LOCKED hands each document to one worker (ADR-0003)', async () => {
    const first = await f.document(subjectId);
    const second = await f.document(subjectId);
    const claim = `SELECT id FROM documents WHERE status = 'queued' ORDER BY uploaded_at, id FOR UPDATE SKIP LOCKED LIMIT 1`;
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await b.query('BEGIN');
      const claimedByA = await a.query(claim);
      const claimedByB = await b.query(claim);
      expect(Number(claimedByA.rows[0].id)).toBe(first);
      expect(Number(claimedByB.rows[0].id)).toBe(second);
    } finally {
      await a.query('ROLLBACK');
      await b.query('ROLLBACK');
      a.release();
      b.release();
    }
  });
});
