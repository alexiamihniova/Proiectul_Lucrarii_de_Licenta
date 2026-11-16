import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  time,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { REMINDER_CHANNELS, THEMES, USER_ROLES, USER_STATUSES } from '../../core/domain.js';
import { createdAt, id, oneOf, ref, timestamptz } from './_helpers.js';

/** UTILIZATOR */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: varchar({ length: 254 }).notNull(),
    passwordHash: varchar({ length: 255 }).notNull(),
    role: varchar({ length: 20 }).notNull().default('student'),
    status: varchar({ length: 20 }).notNull().default('active'),
    gdprConsentAt: timestamptz().notNull(),
    failedLoginAttempts: integer().notNull().default(0),
    lockedUntil: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`),
    check('users_role_check', oneOf(t.role, USER_ROLES)),
    check('users_status_check', oneOf(t.status, USER_STATUSES)),
    check('users_failed_login_attempts_check', sql`${t.failedLoginAttempts} >= 0`),
  ],
);

/** PREFERINȚE (C-23) — exactly one row per user. */
export const preferences = pgTable(
  'preferences',
  {
    userId: ref()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    theme: varchar({ length: 20 }).notNull().default('light'),
    mascotEnabled: boolean().notNull().default(true),
    reminderTime: time().notNull().default('18:00'),
    reminderChannel: varchar({ length: 20 }).notNull().default('in_app'),
    dailyGoal: integer().notNull().default(20),
    /** Not in the SRS: enforces "at most one reminder per day" (RF19). See DATA_MODEL.md. */
    lastReminderSentOn: date({ mode: 'string' }),
  },
  (t) => [
    check('preferences_theme_check', oneOf(t.theme, THEMES)),
    check('preferences_reminder_channel_check', oneOf(t.reminderChannel, REMINDER_CHANNELS)),
    check('preferences_daily_goal_check', sql`${t.dailyGoal} between 5 and 100`),
  ],
);

/** TOKEN_RESETARE (C-24) — only the hash of the token is stored. */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: id(),
    userId: ref()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar({ length: 64 }).notNull(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_token_hash_key').on(t.tokenHash),
    index('password_reset_tokens_user_id_idx').on(t.userId),
    index('password_reset_tokens_expires_at_idx').on(t.expiresAt),
    check('password_reset_tokens_expiry_check', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
