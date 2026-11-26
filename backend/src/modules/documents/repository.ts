import { and, asc, count, desc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { UserActor } from '../../core/actor.js';
import type { DocumentFormat, DocumentStatus } from '../../core/domain.js';
import type { Database, Orm } from '../../db/client.js';
import { documents, passages, sentences, subjects, users } from '../../db/schema/index.js';
import type { DocumentStructure, StructuredText } from './types.js';

/**
 * Queries on `subjects`, `documents`, `passages` and `sentences` — the only code that touches
 * these tables. Every function that reaches a student's data takes the `UserActor` first and
 * filters by it; the functions of the worker (`claimNext` and what follows it) have no actor,
 * because a queued document belongs to nobody until it is claimed.
 *
 * Status changes are decided by `state-machine.ts`; these functions only write the result, and
 * only when the row is still in the status the decision was made from.
 */

type Transaction = Parameters<Parameters<Orm['transaction']>[0]>[0];
type Executor = Orm | Transaction;

export type DocumentRow = typeof documents.$inferSelect;
/** A document with the id of the student who owns it. */
export type DocumentRecord = DocumentRow & { userId: number };

export interface SubjectRecord {
  id: number;
  name: string;
  createdAt: Date;
  /** Documents of the subject that are not deleted. */
  documentCount: number;
}

export interface PassageRecordRow {
  id: number;
  documentId: number;
  position: number;
  page: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

/** The start of the student's day and of the next one, in the application's time zone. */
export interface DayBounds {
  startsAt: Date;
  resetsAt: Date;
}

/** A document taken from the queue: who owns it, and the token that proves it is still ours. */
export interface ClaimedDocument {
  id: number;
  userId: number;
  format: DocumentFormat;
  /** `processing_started_at` as text: later writes are made only while it is unchanged. */
  claim: string;
}

const PG_UNIQUE_VIOLATION = '23505';
/** Rows per INSERT of sentences: 8 columns each, well under the 65 535 parameters of PostgreSQL. */
const INSERT_CHUNK = 2000;

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } } | null) ?? {};
  return code.code === PG_UNIQUE_VIOLATION || code.cause?.code === PG_UNIQUE_VIOLATION;
}

const toPassage = (row: typeof passages.$inferSelect): PassageRecordRow => ({
  id: row.id,
  documentId: row.documentId,
  position: row.position,
  page: row.page,
  startOffset: row.startOffset,
  endOffset: row.endOffset,
  text: row.text,
});

export function createDocumentsRepository(db: Database): DocumentsRepository {
  return build(db.orm);
}

type Queries = ReturnType<typeof queries>;

export interface DocumentsRepository extends Queries {
  /** Runs `work` in one transaction with a repository bound to it. */
  transaction<T>(work: (repository: DocumentsRepository) => Promise<T>): Promise<T>;
}

function build(executor: Executor): DocumentsRepository {
  return {
    ...queries(executor),
    transaction: (work) => executor.transaction((tx) => work(build(tx))),
  };
}

function queries(executor: Executor) {
  return {
    // --- subjects ------------------------------------------------------------------------

    async countSubjects(actor: UserActor): Promise<number> {
      const [row] = await executor
        .select({ total: count() })
        .from(subjects)
        .where(eq(subjects.userId, actor.userId));
      return row?.total ?? 0;
    },

    async listSubjects(
      actor: UserActor,
      page: { limit: number; offset: number },
    ): Promise<SubjectRecord[]> {
      // Table-qualified by hand: inside a raw fragment Drizzle prints bare column names.
      const documentCount = sql<number>`(
        select count(*)::int from documents d
        where d.subject_id = "subjects"."id" and d.status <> 'deleted'
      )`;
      return executor
        .select({
          id: subjects.id,
          name: subjects.name,
          createdAt: subjects.createdAt,
          documentCount,
        })
        .from(subjects)
        .where(eq(subjects.userId, actor.userId))
        .orderBy(sql`lower(${subjects.name})`, asc(subjects.id))
        .limit(page.limit)
        .offset(page.offset);
    },

    async findSubject(actor: UserActor, subjectId: number): Promise<SubjectRecord | null> {
      const documentCount = sql<number>`(
        select count(*)::int from documents d
        where d.subject_id = "subjects"."id" and d.status <> 'deleted'
      )`;
      const [row] = await executor
        .select({
          id: subjects.id,
          name: subjects.name,
          createdAt: subjects.createdAt,
          documentCount,
        })
        .from(subjects)
        .where(and(eq(subjects.id, subjectId), eq(subjects.userId, actor.userId)));
      return row ?? null;
    },

    /** The id of the new subject, or `null` when the student already has that name (Q17). */
    async insertSubject(actor: UserActor, name: string): Promise<number | null> {
      const [row] = await executor
        .insert(subjects)
        .values({ userId: actor.userId, name })
        .onConflictDoNothing()
        .returning({ id: subjects.id });
      return row?.id ?? null;
    },

    /** `false` when the name belongs to another subject of the student. */
    async renameSubject(actor: UserActor, subjectId: number, name: string): Promise<boolean> {
      try {
        await executor
          .update(subjects)
          .set({ name })
          .where(and(eq(subjects.id, subjectId), eq(subjects.userId, actor.userId)));
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },

    /**
     * Deletes the subject and, by cascade, everything below it. Returns the documents it had, so
     * that their files can be removed after the commit; `null` when the subject is not the actor's.
     */
    async deleteSubject(
      actor: UserActor,
      subjectId: number,
    ): Promise<{ id: number; format: DocumentFormat }[] | null> {
      return executor.transaction(async (tx) => {
        const owned = await tx
          .select({ id: subjects.id })
          .from(subjects)
          .where(and(eq(subjects.id, subjectId), eq(subjects.userId, actor.userId)))
          .for('update');
        if (owned.length === 0) return null;
        const files = await tx
          .select({ id: documents.id, format: documents.format })
          .from(documents)
          .where(eq(documents.subjectId, subjectId));
        await tx.delete(subjects).where(eq(subjects.id, subjectId));
        return files.map((file) => ({ id: file.id, format: file.format as DocumentFormat }));
      });
    },

    // --- the day's uploads ---------------------------------------------------------------

    /** Serialises the uploads of one student for the rest of the transaction (design 2.4). */
    async lockUploads(actor: UserActor): Promise<void> {
      await executor.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`documents:upload:${actor.userId}`}, 0))`,
      );
    },

    async dayBounds(now: Date, timeZone: string): Promise<DayBounds> {
      const instant = sql`${now.toISOString()}::timestamptz`;
      const result = await executor.execute<{ starts_at: Date; resets_at: Date }>(sql`
        select
          (date_trunc('day', ${instant} at time zone ${timeZone}) at time zone ${timeZone}) as starts_at,
          ((date_trunc('day', ${instant} at time zone ${timeZone}) + interval '1 day')
            at time zone ${timeZone}) as resets_at
      `);
      const row = result.rows[0]!;
      return { startsAt: new Date(row.starts_at), resetsAt: new Date(row.resets_at) };
    },

    /** Uploads since `since`, deleted documents included: deleting does not give one back. */
    async countUploadsSince(actor: UserActor, since: Date): Promise<number> {
      const [row] = await executor
        .select({ total: count() })
        .from(documents)
        .innerJoin(subjects, eq(subjects.id, documents.subjectId))
        .where(
          and(
            eq(subjects.userId, actor.userId),
            sql`${documents.uploadedAt} >= ${since.toISOString()}::timestamptz`,
          ),
        );
      return row?.total ?? 0;
    },

    async insertDocument(input: {
      subjectId: number;
      fileName: string;
      format: DocumentFormat;
      sizeBytes: number;
    }): Promise<DocumentRow> {
      const [row] = await executor.insert(documents).values(input).returning();
      return row!;
    },

    // --- documents -----------------------------------------------------------------------

    async findDocument(actor: UserActor, documentId: number): Promise<DocumentRecord | null> {
      const [row] = await executor
        .select({ document: documents, userId: subjects.userId })
        .from(documents)
        .innerJoin(subjects, eq(subjects.id, documents.subjectId))
        .where(
          and(
            eq(documents.id, documentId),
            eq(subjects.userId, actor.userId),
            ne(documents.status, 'deleted'),
          ),
        );
      return row ? { ...row.document, userId: row.userId } : null;
    },

    async listDocuments(
      actor: UserActor,
      query: { subjectId?: number; status?: DocumentStatus; limit: number; offset: number },
    ): Promise<{ items: DocumentRow[]; total: number }> {
      const where = and(
        eq(subjects.userId, actor.userId),
        ne(documents.status, 'deleted'),
        query.subjectId === undefined ? undefined : eq(documents.subjectId, query.subjectId),
        query.status === undefined ? undefined : eq(documents.status, query.status),
      );
      const [totals] = await executor
        .select({ total: count() })
        .from(documents)
        .innerJoin(subjects, eq(subjects.id, documents.subjectId))
        .where(where);
      const rows = await executor
        .select({ document: documents })
        .from(documents)
        .innerJoin(subjects, eq(subjects.id, documents.subjectId))
        .where(where)
        .orderBy(desc(documents.uploadedAt), desc(documents.id))
        .limit(query.limit)
        .offset(query.offset);
      return { items: rows.map((row) => row.document), total: totals?.total ?? 0 };
    },

    /** Renames the document while it is in `fromStatus`; `null` when it has changed since. */
    async renameDocument(
      documentId: number,
      fromStatus: DocumentStatus,
      fileName: string,
    ): Promise<DocumentRow | null> {
      const [row] = await executor
        .update(documents)
        .set({ fileName })
        .where(and(eq(documents.id, documentId), eq(documents.status, fromStatus)))
        .returning();
      return row ?? null;
    },

    /**
     * Event ȘT: the row becomes `deleted` (kept, for the daily counter) and its passages go, with
     * the sentences, concept links and materials that hang off them. `false` when the document
     * is no longer in `fromStatus`.
     */
    async markDeleted(documentId: number, fromStatus: DocumentStatus, now: Date): Promise<boolean> {
      return executor.transaction(async (tx) => {
        const changed = await tx
          .update(documents)
          .set({ status: 'deleted', deletedAt: now, errorReason: null })
          .where(and(eq(documents.id, documentId), eq(documents.status, fromStatus)))
          .returning({ id: documents.id });
        if (changed.length === 0) return false;
        await tx.delete(passages).where(eq(passages.documentId, documentId));
        return true;
      });
    },

    /** Event RP: back to the queue, without the old error. `null` when the status has changed. */
    async requeue(
      documentId: number,
      fromStatus: DocumentStatus,
      toStatus: DocumentStatus,
    ): Promise<DocumentRow | null> {
      const [row] = await executor
        .update(documents)
        .set({ status: toStatus, errorReason: null })
        .where(and(eq(documents.id, documentId), eq(documents.status, fromStatus)))
        .returning();
      return row ?? null;
    },

    // --- passages and structure ------------------------------------------------------------

    async countPassages(documentId: number, pageNumber?: number): Promise<number> {
      const [row] = await executor
        .select({ total: count() })
        .from(passages)
        .where(
          and(
            eq(passages.documentId, documentId),
            pageNumber === undefined ? undefined : eq(passages.page, pageNumber),
          ),
        );
      return row?.total ?? 0;
    },

    async listPassages(
      documentId: number,
      query: { pageNumber?: number; limit: number; offset: number },
    ): Promise<PassageRecordRow[]> {
      const rows = await executor
        .select()
        .from(passages)
        .where(
          and(
            eq(passages.documentId, documentId),
            query.pageNumber === undefined ? undefined : eq(passages.page, query.pageNumber),
          ),
        )
        .orderBy(asc(passages.position))
        .limit(query.limit)
        .offset(query.offset);
      return rows.map(toPassage);
    },

    async passagesByIds(documentId: number, ids: number[]): Promise<PassageRecordRow[]> {
      if (ids.length === 0) return [];
      const rows = await executor
        .select()
        .from(passages)
        .where(and(eq(passages.documentId, documentId), inArray(passages.id, ids)))
        .orderBy(asc(passages.position));
      return rows.map(toPassage);
    },

    /** The stored structure of a document, or `null` while there is no text. */
    async structureOf(documentId: number): Promise<DocumentStructure | null> {
      const [document] = await executor
        .select({ pageCount: documents.pageCount })
        .from(documents)
        .where(and(eq(documents.id, documentId), ne(documents.status, 'deleted')));
      if (!document) return null;
      const passageRows = await executor
        .select()
        .from(passages)
        .where(eq(passages.documentId, documentId))
        .orderBy(asc(passages.position));
      if (passageRows.length === 0) return null;
      const sentenceRows = await executor
        .select()
        .from(sentences)
        .where(eq(sentences.documentId, documentId))
        .orderBy(asc(sentences.position));

      const positionOf = new Map(passageRows.map((row) => [row.id, row.position]));
      const bounds = new Map<number, { first: number; last: number }>();
      let text = '';
      const sentenceList = sentenceRows.map((row, index) => {
        // The canonical text is the sentences, joined as design 3.2 says.
        if (index > 0) text += row.paragraph === sentenceRows[index - 1]!.paragraph ? ' ' : '\n\n';
        text += row.text;
        const passagePosition = positionOf.get(row.passageId)!;
        const seen = bounds.get(passagePosition);
        bounds.set(passagePosition, { first: seen?.first ?? row.position, last: row.position });
        return {
          position: row.position,
          paragraph: row.paragraph,
          page: row.page,
          startOffset: row.startOffset,
          endOffset: row.endOffset,
          text: row.text,
          passagePosition,
          passageId: row.passageId,
        };
      });
      return {
        documentId,
        text,
        pageCount: document.pageCount ?? 1,
        sentences: sentenceList,
        passages: passageRows.map((row) => ({
          id: row.id,
          position: row.position,
          page: row.page,
          startOffset: row.startOffset,
          endOffset: row.endOffset,
          text: row.text,
          firstSentence: bounds.get(row.position)!.first,
          lastSentence: bounds.get(row.position)!.last,
        })),
      };
    },

    // --- the queue and the analysis (the worker: no actor) -------------------------------

    /**
     * Event PP: takes the oldest queued document, if any. `processingStatus` is the status the
     * state machine gives to PP; the claim token is the exact moment, as text, so that no other
     * write can be mistaken for ours.
     */
    async claimNext(processingStatus: DocumentStatus): Promise<ClaimedDocument | null> {
      return executor.transaction(async (tx) => {
        const next = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.status, 'queued'))
          .orderBy(asc(documents.uploadedAt), asc(documents.id))
          .limit(1)
          .for('update', { skipLocked: true });
        if (next.length === 0) return null;
        const [claimed] = await tx
          .update(documents)
          .set({ status: processingStatus, processingStartedAt: sql`clock_timestamp()` })
          .where(eq(documents.id, next[0]!.id))
          .returning({
            id: documents.id,
            format: documents.format,
            subjectId: documents.subjectId,
            claim: sql<string>`${documents.processingStartedAt}::text`,
          });
        const [owner] = await tx
          .select({ userId: subjects.userId })
          .from(subjects)
          .where(eq(subjects.id, claimed!.subjectId));
        return {
          id: claimed!.id,
          userId: owner!.userId,
          format: claimed!.format as DocumentFormat,
          claim: claimed!.claim,
        };
      });
    },

    async hasPassages(documentId: number): Promise<boolean> {
      const [row] = await executor
        .select({ total: count() })
        .from(passages)
        .where(eq(passages.documentId, documentId));
      return (row?.total ?? 0) > 0;
    },

    /**
     * Stores the page count, the passages and the sentences of a claimed document, all or
     * nothing. `false` (and nothing stored) when the claim is no longer ours: the document was
     * deleted, failed on time or was claimed again (C-08, C-10).
     */
    async storeStructure(claimed: ClaimedDocument, structure: StructuredText): Promise<boolean> {
      return executor.transaction(async (tx) => {
        const stillOurs = await tx
          .update(documents)
          .set({ pageCount: structure.pageCount })
          .where(
            and(
              eq(documents.id, claimed.id),
              eq(documents.status, 'processing'),
              sql`${documents.processingStartedAt}::text = ${claimed.claim}`,
            ),
          )
          .returning({ id: documents.id });
        if (stillOurs.length === 0) return false;

        const passageIds = new Map<number, number>();
        for (let from = 0; from < structure.passages.length; from += INSERT_CHUNK) {
          const chunk = structure.passages.slice(from, from + INSERT_CHUNK);
          const rows = await tx
            .insert(passages)
            .values(
              chunk.map((passage) => ({
                documentId: claimed.id,
                position: passage.position,
                page: passage.page,
                startOffset: passage.startOffset,
                endOffset: passage.endOffset,
                text: passage.text,
              })),
            )
            .returning({ id: passages.id, position: passages.position });
          for (const row of rows) passageIds.set(row.position, row.id);
        }
        for (let from = 0; from < structure.sentences.length; from += INSERT_CHUNK) {
          await tx.insert(sentences).values(
            structure.sentences.slice(from, from + INSERT_CHUNK).map((sentence) => ({
              documentId: claimed.id,
              passageId: passageIds.get(sentence.passagePosition)!,
              position: sentence.position,
              paragraph: sentence.paragraph,
              page: sentence.page,
              startOffset: sentence.startOffset,
              endOffset: sentence.endOffset,
              text: sentence.text,
            })),
          );
        }
        return true;
      });
    },

    /**
     * Events PR and PE: the claimed document leaves `processing`. `false` when the claim is no
     * longer ours; the late result is then simply dropped (C-08, C-10).
     */
    async finishClaimed(
      claimed: ClaimedDocument,
      toStatus: DocumentStatus,
      errorReason: string | null,
    ): Promise<boolean> {
      const changed = await executor
        .update(documents)
        .set({ status: toStatus, errorReason })
        .where(
          and(
            eq(documents.id, claimed.id),
            eq(documents.status, 'processing'),
            sql`${documents.processingStartedAt}::text = ${claimed.claim}`,
          ),
        )
        .returning({ id: documents.id });
      return changed.length > 0;
    },

    /** Event PE for documents that have been in `processing` since before `cutoff`. */
    async failProcessingStartedBefore(
      cutoff: Date,
      toStatus: DocumentStatus,
      errorReason: string,
    ): Promise<number> {
      const changed = await executor
        .update(documents)
        .set({ status: toStatus, errorReason })
        .where(and(eq(documents.status, 'processing'), lt(documents.processingStartedAt, cutoff)))
        .returning({ id: documents.id });
      return changed.length;
    },

    // --- clean-up ---------------------------------------------------------------------------

    async deleteDeletedBefore(cutoff: Date): Promise<number> {
      const removed = await executor
        .delete(documents)
        .where(and(eq(documents.status, 'deleted'), lt(documents.deletedAt, cutoff)))
        .returning({ id: documents.id });
      return removed.length;
    },

    /** Which of these documents exist and are not deleted (their files must stay). */
    async liveDocumentIds(ids: number[]): Promise<Set<number>> {
      if (ids.length === 0) return new Set();
      const rows = await executor
        .select({ id: documents.id })
        .from(documents)
        .where(and(inArray(documents.id, ids), ne(documents.status, 'deleted')));
      return new Set(rows.map((row) => row.id));
    },

    async existingUserIds(ids: number[]): Promise<Set<number>> {
      if (ids.length === 0) return new Set();
      const rows = await executor
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, ids));
      return new Set(rows.map((row) => row.id));
    },
  };
}
