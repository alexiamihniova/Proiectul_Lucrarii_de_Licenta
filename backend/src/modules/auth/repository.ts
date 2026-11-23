import { and, count, desc, eq, gt, ilike, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { UserRole, UserStatus } from '../../core/domain.js';
import type { Database, Orm } from '../../db/client.js';
import { passwordResetTokens, preferences, users } from '../../db/schema/index.js';
import type { AuthRepository, PreferencesRecord, ResetTokenRecord, UserRecord } from './types.js';

/**
 * Queries on `users`, `preferences`, `password_reset_tokens` — the only code that touches
 * these tables. The data export (RF20) reads other modules' tables through
 * `modules/shared-queries` (ADR-0014).
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
