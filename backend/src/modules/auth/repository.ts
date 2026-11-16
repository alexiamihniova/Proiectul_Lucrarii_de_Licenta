import { and, count, desc, eq, gt, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { UserActor } from '../../core/actor.js';
import type { UserRole, UserStatus } from '../../core/domain.js';
import type { Database, Orm } from '../../db/client.js';
import {
  answers,
  conceptProgress,
  concepts,
  materials,
  passwordResetTokens,
  preferences,
  subjects,
  tests,
  users,
} from '../../db/schema/index.js';
import type { AuthRepository, PreferencesRecord, ResetTokenRecord, UserRecord } from './types.js';

/**
 * Queries on `users`, `preferences`, `password_reset_tokens` — the only code that touches
 * these tables — plus the read-only queries of the data export (see `readStudyData`).
 */

type Transaction = Parameters<Parameters<Orm['transaction']>[0]>[0];
type Executor = Orm | Transaction;

type UserRow = typeof users.$inferSelect;
type PreferencesRow = typeof preferences.$inferSelect;

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    gdprConsentAt: row.gdprConsentAt,
    gdprConsentVersion: row.gdprConsentVersion,
    failedLoginAttempts: row.failedLoginAttempts,
    lockedUntil: row.lockedUntil,
    createdAt: row.createdAt,
  };
}

function toPreferences(row: PreferencesRow): PreferencesRecord {
  return {
    theme: row.theme as PreferencesRecord['theme'],
    mascot_enabled: row.mascotEnabled,
    // PostgreSQL returns TIME as HH:MM:SS; the API speaks HH:MM.
    reminder_time: row.reminderTime.slice(0, 5),
    reminder_channel: row.reminderChannel as PreferencesRecord['reminder_channel'],
    daily_goal: row.dailyGoal,
  };
}

/** Escapes the wildcards of LIKE, so that a search for `50%` finds exactly that text. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function build(executor: Executor): AuthRepository {
  const transaction = <T>(work: (repository: AuthRepository) => Promise<T>): Promise<T> =>
    executor.transaction((tx) => work(build(tx)));

  return {
    transaction,

    async findUserByEmail(normalisedEmail) {
      const [row] = await executor
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${normalisedEmail}`)
        .limit(1);
      return row ? toUser(row) : null;
    },

    async findUserById(userId) {
      const [row] = await executor.select().from(users).where(eq(users.id, userId)).limit(1);
      return row ? toUser(row) : null;
    },

    createUser(input) {
      // One transaction: an account never exists without its preferences row (C-23).
      return executor.transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            email: input.email,
            passwordHash: input.passwordHash,
            role: input.role,
            gdprConsentAt: input.gdprConsentAt,
            gdprConsentVersion: input.gdprConsentVersion,
          })
          .onConflictDoNothing()
          .returning();
        if (!row) return null;
        await tx.insert(preferences).values({ userId: row.id });
        return toUser(row);
      });
    },

    async incrementFailedLogins(userId) {
      const [row] = await executor
        .update(users)
        .set({ failedLoginAttempts: sql`${users.failedLoginAttempts} + 1` })
        .where(eq(users.id, userId))
        .returning({ attempts: users.failedLoginAttempts });
      return row?.attempts ?? 0;
    },

    async setLockedUntil(userId, lockedUntil) {
      await executor.update(users).set({ lockedUntil }).where(eq(users.id, userId));
    },

    async clearLoginFailures(userId) {
      await executor
        .update(users)
        .set({ failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    async setPasswordHash(userId, passwordHash) {
      await executor
        .update(users)
        .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(users.id, userId));
    },

    async setStatus(userId, status) {
      await executor.update(users).set({ status }).where(eq(users.id, userId));
    },

    async deleteUser(userId) {
      const deleted = await executor
        .delete(users)
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      return deleted.length > 0;
    },

    async listUsers(query) {
      const filters: SQL[] = [];
      if (query.status) filters.push(eq(users.status, query.status));
      if (query.search) filters.push(ilike(users.email, likePattern(query.search)));
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [totals] = await executor.select({ total: count() }).from(users).where(where);
      // Table-qualified by hand: inside a raw fragment Drizzle prints bare column names.
      const documentCount = sql<number>`(
        select count(*)::int from documents d
        join subjects s on s.id = d.subject_id
        where s.user_id = "users"."id" and d.status <> 'deleted'
      )`;
      const rows = await executor
        .select({ user: users, documentCount })
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt), desc(users.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return {
        items: rows.map((row) => ({ ...toUser(row.user), documentCount: row.documentCount })),
        total: totals?.total ?? 0,
      };
    },

    async getPreferences(actor) {
      const [row] = await executor
        .select()
        .from(preferences)
        .where(eq(preferences.userId, actor.userId))
        .limit(1);
      if (!row) throw new Error(`user ${actor.userId} has no preferences row (C-23)`);
      return toPreferences(row);
    },

    async updatePreferences(actor, changes) {
      const set: Partial<typeof preferences.$inferInsert> = {};
      if (changes.theme !== undefined) set.theme = changes.theme;
      if (changes.mascot_enabled !== undefined) set.mascotEnabled = changes.mascot_enabled;
      if (changes.reminder_time !== undefined) set.reminderTime = changes.reminder_time;
      if (changes.reminder_channel !== undefined) set.reminderChannel = changes.reminder_channel;
      if (changes.daily_goal !== undefined) set.dailyGoal = changes.daily_goal;
      if (Object.keys(set).length > 0) {
        await executor.update(preferences).set(set).where(eq(preferences.userId, actor.userId));
      }
      return this.getPreferences(actor);
    },

    async createResetToken(input) {
      await executor.insert(passwordResetTokens).values(input);
    },

    async countResetTokensCreatedSince(userId, since) {
      const [row] = await executor
        .select({ total: count() })
        .from(passwordResetTokens)
        .where(
          and(eq(passwordResetTokens.userId, userId), gt(passwordResetTokens.createdAt, since)),
        );
      return row?.total ?? 0;
    },

    async consumeResetToken(tokenHash, now) {
      const [row] = await executor
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        )
        .returning();
      return (row as ResetTokenRecord | undefined) ?? null;
    },

    async invalidateResetTokens(userId, now) {
      await executor
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    },

    async purgeResetTokens(now) {
      const deleted = await executor
        .delete(passwordResetTokens)
        .where(or(lt(passwordResetTokens.expiresAt, now), isNotNull(passwordResetTokens.usedAt)))
        .returning({ id: passwordResetTokens.id });
      return deleted.length;
    },
  };
}

export function createAuthRepository(db: Database): AuthRepository {
  return build(db.orm);
}

// --- data export (RF20) ---------------------------------------------------------------------

/** The data sets of the export and their columns, in the order they appear in the CSV files. */
export const STUDY_DATA_COLUMNS = {
  subjects: ['id', 'name', 'created_at'],
  concepts: ['id', 'subject_id', 'name', 'definition', 'origin', 'created_at'],
  tests: ['id', 'subject_id', 'started_at', 'finished_at', 'total_score'],
  answers: ['id', 'test_id', 'material_id', 'given_answer', 'score', 'quality', 'answered_at'],
  progress: ['concept_id', 'mastery', 'status', 'updated_at'],
} as const;

export type StudyData = Record<keyof typeof STUDY_DATA_COLUMNS, Record<string, unknown>[]>;

/**
 * The study data of ONE user, for the export of RF20: subjects, concepts, results, progress.
 *
 * These tables belong to the documents, analysis, content and mastery modules. Design 5.4
 * says their data is asked from their services, which do not exist before Segments 2–5, while
 * the export has to work now (docs/OPEN_QUESTIONS.md, Q45). Until then the export reads them
 * here: read-only, a fixed list of columns, every query filtered by `actor.userId`. No document
 * text and no generated material is exported. An answer has no direct link to a user (Q24),
 * so answers are reached through the subject that owns their material.
 */
export async function readStudyData(db: Database, actor: UserActor): Promise<StudyData> {
  const orm = db.orm;
  const owned = eq(subjects.userId, actor.userId);

  const [subjectRows, conceptRows, testRows, answerRows, progressRows] = await Promise.all([
    orm
      .select({ id: subjects.id, name: subjects.name, created_at: subjects.createdAt })
      .from(subjects)
      .where(owned)
      .orderBy(subjects.id),
    orm
      .select({
        id: concepts.id,
        subject_id: concepts.subjectId,
        name: concepts.name,
        definition: concepts.definition,
        origin: concepts.origin,
        created_at: concepts.createdAt,
      })
      .from(concepts)
      .innerJoin(subjects, eq(subjects.id, concepts.subjectId))
      .where(owned)
      .orderBy(concepts.id),
    orm
      .select({
        id: tests.id,
        subject_id: tests.subjectId,
        started_at: tests.startedAt,
        finished_at: tests.finishedAt,
        total_score: tests.totalScore,
      })
      .from(tests)
      .where(eq(tests.userId, actor.userId))
      .orderBy(tests.id),
    orm
      .select({
        id: answers.id,
        test_id: answers.testId,
        material_id: answers.materialId,
        given_answer: answers.givenAnswer,
        score: answers.score,
        quality: answers.quality,
        answered_at: answers.answeredAt,
      })
      .from(answers)
      .innerJoin(materials, eq(materials.id, answers.materialId))
      .innerJoin(concepts, eq(concepts.id, materials.conceptId))
      .innerJoin(subjects, eq(subjects.id, concepts.subjectId))
      .where(owned)
      .orderBy(answers.id),
    orm
      .select({
        concept_id: conceptProgress.conceptId,
        mastery: conceptProgress.mastery,
        status: conceptProgress.status,
        updated_at: conceptProgress.updatedAt,
      })
      .from(conceptProgress)
      .where(eq(conceptProgress.userId, actor.userId))
      .orderBy(conceptProgress.conceptId),
  ]);

  return {
    subjects: subjectRows,
    concepts: conceptRows,
    tests: testRows,
    answers: answerRows,
    progress: progressRows,
  };
}
