import { defineConfig } from 'vitest/config';

/**
 * TEMPORARY (Segment 1A → 1B). Runs the account and access specification in tests/auth/.
 * These tests fail until Segment 1B implements the auth module, so they are kept out of
 * `npm test` (see `exclude` in vitest.config.ts) and run with `npm run test:auth`.
 *
 * Segment 1B, when the tests pass: delete this file, the `test:auth` script, the `exclude`
 * line in vitest.config.ts and the `auth-spec` job in .github/workflows/ci.yml.
 */
export default defineConfig({
  test: {
    include: ['tests/auth/**/*.test.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
