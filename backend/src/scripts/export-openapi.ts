import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../app.js';
import { loadConfig } from '../core/config.js';
import type { Database } from '../db/client.js';

/**
 * Writes the OpenAPI document generated from the route schemas to docs/openapi.json.
 * Needs no database and no real configuration. CI fails when the committed file is stale.
 *
 * Usage: `npm run openapi:export` (or `make openapi`); `-- --check` only compares.
 */
const OUTPUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'docs',
  'openapi.json',
);

export async function generateOpenApi(): Promise<string> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://unused/unused',
    SESSION_SECRET: 'x'.repeat(32),
    SMTP_HOST: 'unused',
    SMTP_FROM: 'unused@example.com',
  });
  const db = { pool: {}, orm: {}, close: async () => undefined } as unknown as Database;
  const app = await buildApp({ config, db });
  await app.ready();
  const document = JSON.stringify(app.swagger(), null, 2) + '\n';
  await app.close();
  return document;
}

async function main(): Promise<void> {
  const document = await generateOpenApi();
  if (process.argv.includes('--check')) {
    const { readFileSync } = await import('node:fs');
    if (readFileSync(OUTPUT, 'utf8') !== document) {
      process.stderr.write('docs/openapi.json is out of date. Run `make openapi` and commit.\n');
      process.exit(1);
    }
    process.stdout.write('docs/openapi.json is up to date\n');
    return;
  }
  writeFileSync(OUTPUT, document);
  process.stdout.write(`wrote ${OUTPUT}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
