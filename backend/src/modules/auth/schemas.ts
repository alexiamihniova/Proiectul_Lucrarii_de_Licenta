import { z } from 'zod';
import { REMINDER_CHANNELS, THEMES, USER_ROLES, USER_STATUSES } from '../../core/domain.js';
import { Id, Timestamp } from '../../core/http.js';

/** An e-mail address as stored and returned: already normalised. */
export const Email = z.email().max(254).meta({ example: 'student@example.com' });

/**
 * An e-mail address as received (RF1; design 1.1): surrounding whitespace is removed and the
 * address is lower-cased BEFORE the format and the 254-character limit are checked. Every
 * request that carries an e-mail uses this schema, so normalisation cannot be forgotten.
 */
export const EmailInput = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254))
  .meta({ example: 'student@example.com' });

/**
 * RF1: 8–64 characters, at least one letter and one digit. The password is never trimmed or
 * changed. The 72-byte limit of bcrypt (Q34) is checked by the service, because it answers
 * with its own error code (`PASSWORD_TOO_LONG`).
 */
export const Password = z
  .string()
  .min(8)
  .max(64)
  .regex(/\p{L}/u, 'must contain at least one letter')
  .regex(/\d/, 'must contain at least one digit')
  .meta({ example: 'parola123' });

export const User = z
  .object({
    id: Id,
    email: Email,
    role: z.enum(USER_ROLES),
    status: z.enum(USER_STATUSES),
    created_at: Timestamp,
  })
  .meta({ id: 'User' });

export const SessionResponse = z
  .object({
    user: User,
    expires_at: Timestamp.describe('When the session cookie expires (≤ 24 h, RF2, C-11)'),
  })
  .meta({ id: 'SessionResponse' });

export const RegisterRequest = z
  .object({
    email: EmailInput,
    password: Password,
    password_confirmation: z.string().describe('Must equal `password`'),
    gdpr_consent: z.literal(true).describe('Consent to data processing; must be true (RF1)'),
  })
  .meta({ id: 'RegisterRequest' });

export const LoginRequest = z
  .object({ email: EmailInput, password: z.string().min(1).max(64) })
  .meta({ id: 'LoginRequest' });

export const PasswordResetRequest = z
  .object({ email: EmailInput })
  .meta({ id: 'PasswordResetRequest' });

export const PasswordResetConfirm = z
  .object({
    token: z.string().min(1).max(200).describe('Token from the e-mailed link (1 h, single use)'),
    password: Password,
    password_confirmation: z.string(),
  })
  .meta({ id: 'PasswordResetConfirm' });

const ReminderTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .meta({ description: 'HH:MM, Europe/Chisinau', example: '18:00' });

/** RF18, C-23 */
export const Preferences = z
  .object({
    theme: z.enum(THEMES),
    mascot_enabled: z.boolean(),
    reminder_time: ReminderTime,
    reminder_channel: z.enum(REMINDER_CHANNELS),
    daily_goal: z.int().min(5).max(100).describe('Reviews per day'),
  })
  .meta({ id: 'Preferences' });

export const PreferencesUpdate = Preferences.partial().meta({ id: 'PreferencesUpdate' });

export const AccountDeleteRequest = z
  .object({ password: z.string().min(1).max(64).describe('Current password, as confirmation') })
  .meta({ id: 'AccountDeleteRequest' });

export const ExportQuery = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});

/** RF20: subjects, concepts, results, progress. */
export const AccountExport = z
  .object({
    exported_at: Timestamp,
    user: User,
    preferences: Preferences,
    subjects: z.array(z.record(z.string(), z.unknown())),
    concepts: z.array(z.record(z.string(), z.unknown())),
    tests: z.array(z.record(z.string(), z.unknown())),
    answers: z.array(z.record(z.string(), z.unknown())),
    progress: z.array(z.record(z.string(), z.unknown())),
  })
  .meta({ id: 'AccountExport' });
