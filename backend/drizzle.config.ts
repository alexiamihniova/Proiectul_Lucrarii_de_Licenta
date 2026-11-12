import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only diffs the schema against drizzle/meta; it never connects to a
// database. Migrations are applied by src/db/migrate.ts (see ADR-0002).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
});
