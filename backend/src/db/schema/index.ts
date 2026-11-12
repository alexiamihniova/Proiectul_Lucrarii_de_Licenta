/**
 * Database schema: 16 tables (SRS Tabelul 3.21 + TOKEN_RESETARE). See docs/DATA_MODEL.md.
 * Lives outside the modules on purpose: migrations need every table, and foreign keys cross
 * module boundaries. Only `repository.ts` files import it.
 */
export * from './accounts.js';
export * from './documents.js';
export * from './content.js';
export * from './mastery.js';
export * from './admin.js';
