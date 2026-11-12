import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { ERRORS } from './errors.js';

export const API_PREFIX = '/api/v1';

const errorCatalogue = Object.entries(ERRORS)
  .map(([code, def]) => {
    const srs = 'srs' in def ? ` (${def.srs})` : '';
    return `| \`${code}\` | ${def.status} | ${def.message}${srs} |`;
  })
  .join('\n');

const description = `
Contract of the active-recall web application (bachelor thesis). Generated from the Zod schemas
in \`backend/src/modules/*/schemas.ts\`; do not edit \`docs/openapi.json\` by hand.

**Conventions**

- Base path \`${API_PREFIX}\`; JSON bodies; \`snake_case\` field names; integer ids;
  ISO 8601 UTC timestamps; \`YYYY-MM-DD\` dates.
- Authentication: session JWT (≤ 24 h) in an httpOnly cookie, sent automatically by the browser.
- Collections: \`?page=&page_size=\` → \`{ items, total, page, page_size }\`.
- Errors: \`{ "error": { "code", "message", "details" } }\`.
- Each operation summary starts with the use cases it serves, e.g. \`[UC-04]\`.
- Routes answer \`501 NOT_IMPLEMENTED\` until their segment is built.

**Error catalogue**

| code | HTTP | message (SRS id) |
|---|---|---|
${errorCatalogue}
`;

/**
 * File uploads are parsed by @fastify/multipart, not validated by a Zod body schema, so their
 * request body is described here, keyed by operationId.
 */
const MULTIPART_BODIES: Record<string, object> = {
  uploadDocument: {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          required: ['file'],
          properties: {
            file: { type: 'string', format: 'binary', description: 'PDF, DOCX or TXT file' },
          },
        },
      },
    },
  },
};

function addMultipartBodies<T>(document: T): T {
  const paths = (document as { paths?: Record<string, Record<string, { operationId?: string }>> })
    .paths;
  for (const item of Object.values(paths ?? {})) {
    for (const operation of Object.values(item)) {
      const body = operation.operationId ? MULTIPART_BODIES[operation.operationId] : undefined;
      if (body) Object.assign(operation, { requestBody: body });
    }
  }
  return document;
}

/**
 * The Zod provider emits an `…Input` twin for every registered schema even when no request
 * uses it. Drop component schemas that nothing references and sort the rest, so the contract
 * stays readable and identical from run to run.
 */
function pruneUnusedSchemas<T>(input: T): T {
  // Work on a copy: the provider hands out objects it reuses between calls.
  const document = structuredClone(input);
  const schemas = (document as { components?: { schemas?: Record<string, unknown> } }).components
    ?.schemas;
  if (!schemas) return document;
  for (;;) {
    const text = JSON.stringify(document);
    const unused = Object.keys(schemas).filter(
      (name) => !text.includes(`"#/components/schemas/${name}"`),
    );
    for (const name of unused) delete schemas[name];
    if (unused.length === 0) break;
  }
  // Registration order depends on module import order; sort for a stable, diffable document.
  const sorted = Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b)));
  for (const name of Object.keys(schemas)) delete schemas[name];
  Object.assign(schemas, sorted);
  return document;
}

export async function registerOpenApi(app: FastifyInstance, config: Config): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Recap API', version: '0.1.0', description },
      servers: [
        { url: '/', description: 'Same origin (the frontend proxies /api to the backend)' },
      ],
      tags: [
        { name: 'system', description: 'Health' },
        { name: 'auth', description: 'Segment 1 — accounts, sessions, preferences, personal data' },
        { name: 'documents', description: 'Segment 2 — subjects, upload, document lifecycle' },
        { name: 'analysis', description: 'Segment 3 — concepts and verified sources' },
        { name: 'content', description: 'Segment 4 — materials and tests' },
        { name: 'mastery', description: 'Segment 5 — progress and SM-2 reviews' },
        { name: 'admin', description: 'Segment 7 — administration' },
        { name: 'reminders', description: 'Segment 8 — reminders and e-mail' },
      ],
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: config.session.cookieName },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: (input) =>
      pruneUnusedSchemas(addMultipartBodies(jsonSchemaTransformObject(input))),
  });

  if (config.env !== 'production') {
    await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  }
}
