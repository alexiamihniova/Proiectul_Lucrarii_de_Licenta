/**
 * Segment 2: queries on `subjects`, `documents`, `passages`.
 *
 * The queue claim (ADR-0003) is one statement, run inside a transaction:
 *
 *   UPDATE documents SET status = 'processing', processing_started_at = now()
 *   WHERE id = (SELECT id FROM documents WHERE status = 'queued'
 *               ORDER BY uploaded_at FOR UPDATE SKIP LOCKED LIMIT 1)
 *   RETURNING *;
 */
export {};
