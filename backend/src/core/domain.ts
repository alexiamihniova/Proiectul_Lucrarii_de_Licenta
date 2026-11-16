/**
 * Shared domain vocabulary: the closed value sets used by BOTH the database schema (CHECK
 * constraints) and the API schemas (Zod enums). Changing a list here requires a migration.
 * Romanian ↔ English correspondence: docs/DATA_MODEL.md.
 */

export const USER_ROLES = ['student', 'admin'] as const;
export const USER_STATUSES = ['active', 'blocked'] as const;

export const THEMES = ['light', 'dark'] as const;
export const REMINDER_CHANNELS = ['email', 'in_app', 'both'] as const;

export const DOCUMENT_FORMATS = ['pdf', 'docx', 'txt'] as const;
/** În coadă, În analiză, Gata, Eroare, Șters (Dosar, Tabelul 3.1). */
export const DOCUMENT_STATUSES = ['queued', 'processing', 'ready', 'error', 'deleted'] as const;

export const CONCEPT_ORIGINS = ['model', 'manual'] as const;

/** rezumat, flashcard, grilă, deschisă (= „răspuns scurt”), adevărat/fals. */
export const MATERIAL_TYPES = [
  'summary',
  'flashcard',
  'multiple_choice',
  'open',
  'true_false',
] as const;
export const MATERIAL_STATUSES = ['valid', 'reported', 'removed'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/** Nou, De recapitulat (<50), În curs (50–80), Stăpânit (>80). */
export const MASTERY_STATUSES = ['new', 'to_review', 'in_progress', 'mastered'] as const;

export const REPORT_STATUSES = ['new', 'resolved'] as const;

export const LLM_OPERATIONS = [
  'extract_concepts',
  'generate_materials',
  'evaluate_answer',
] as const;
export const LLM_CALL_STATUSES = ['success', 'error', 'timeout', 'invalid_response'] as const;

/** Keys of the `settings` table (CONFIGURARE, RF25 + SRS 3.2.4.2). */
export const SETTING_KEYS = [
  'max_file_size_mb',
  'uploads_per_day',
  'mastery_threshold_low',
  'mastery_threshold_high',
  'mastery_window',
  'mastery_decay',
  'monthly_cost_limit',
] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type UserStatus = (typeof USER_STATUSES)[number];
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type MaterialType = (typeof MATERIAL_TYPES)[number];
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type MasteryStatus = (typeof MASTERY_STATUSES)[number];
export type LlmOperation = (typeof LLM_OPERATIONS)[number];
export type LlmCallStatus = (typeof LLM_CALL_STATUSES)[number];
export type SettingKey = (typeof SETTING_KEYS)[number];
