import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Module boundary rule (see CLAUDE.md): code in src/modules/<a> may import from another
 * module <b> only through src/modules/<b>/service.ts. Routers, repositories and schemas
 * of other modules are private.
 */
const crossModuleInternals = {
  group: ['../*/router.js', '../*/repository.js', '../*/schemas.js', '**/modules/*/repository.js'],
  message: 'Import other modules only through their service.ts (see CLAUDE.md).',
};

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'drizzle', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    files: ['src/modules/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [crossModuleInternals] }] },
  },
  {
    // Only a module's own `repository.ts` queries the database (CLAUDE.md, rule 4), with ONE
    // exception: the folder `shared-queries`, the single place for read queries that cross
    // module boundaries (ADR-0014). Anything else that needs a table of another module goes
    // there; do not add a second exception.
    files: ['src/modules/**/*.ts'],
    ignores: ['src/modules/**/repository.ts', 'src/modules/shared-queries/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossModuleInternals,
            {
              group: ['**/db/schema/**', '**/db/schema', 'drizzle-orm', 'drizzle-orm/*'],
              message:
                'Only repository.ts queries the database; cross-module reads go through shared-queries (ADR-0014).',
            },
          ],
        },
      ],
    },
  },
  {
    // The database schema is shared infrastructure, but only repositories may query it.
    files: ['src/modules/**/router.ts', 'src/modules/**/schemas.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            crossModuleInternals,
            {
              group: ['**/db/*', '**/db/**'],
              message: 'Only repository.ts talks to the database.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
