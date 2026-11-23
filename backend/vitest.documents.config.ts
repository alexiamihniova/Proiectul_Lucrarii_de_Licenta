import { defineConfig } from 'vitest/config';

/**
 * TEMPORARY (Segment 2A → 2B). Runs the subjects and documents specification in
 * tests/documents/. These tests fail until Segment 2B implements the documents module, so they
 * are kept out of `npm test` (see `exclude` in vitest.config.ts) and run with
 * `npm run test:documents`.
 *
 * Segment 2B, when the tests pass: delete this file, the `test:documents` script, the
 * `test-documents` make target, the `exclude` line in vitest.config.ts and the
 * `documents-spec` job in .github/workflows/ci.yml.
 */
export default defineConfig({
  test: {
    include: ['tests/documents/**/*.test.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
