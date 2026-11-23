import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // TEMPORARY: the documents specification fails until Segment 2B. See vitest.documents.config.ts.
    exclude: ['tests/documents/**', 'node_modules/**'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    // All files share one PostgreSQL database and the migration test drops the schema.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
