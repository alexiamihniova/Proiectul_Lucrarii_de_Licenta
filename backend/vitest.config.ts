import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // TEMPORARY: the auth specification fails until Segment 1B. See vitest.auth.config.ts.
    exclude: ['tests/auth/**', 'node_modules/**'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    // All files share one PostgreSQL database and the migration test drops the schema.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
