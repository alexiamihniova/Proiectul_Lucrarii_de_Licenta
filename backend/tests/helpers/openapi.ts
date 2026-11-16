import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The committed contract, read once. Tests that walk "every route" start from here. */

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  security?: unknown[];
  parameters?: { name: string; in: 'path' | 'query'; required?: boolean }[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

export interface ApiOperation {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** OpenAPI path, e.g. `/api/v1/documents/{document_id}`. */
  path: string;
  op: OpenApiOperation;
  access: 'public' | 'any' | 'student' | 'admin';
  pathParams: string[];
  queryParams: string[];
}

const UNSAFE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

function accessOf(op: OpenApiOperation): ApiOperation['access'] {
  if (op.security?.length === 0) return 'public';
  const description = op.description ?? '';
  if (description.includes('role `admin`')) return 'admin';
  if (description.includes('role `student`')) return 'student';
  if (description.includes('any role')) return 'any';
  throw new Error(`cannot tell the access level of ${op.operationId} from its description`);
}

export function loadOperations(): ApiOperation[] {
  const spec = JSON.parse(readFileSync(resolve('..', 'docs', 'openapi.json'), 'utf8')) as {
    paths: Record<string, Record<string, OpenApiOperation>>;
  };
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, op]) => !op.tags.includes('system'))
      .map(([method, op]) => ({
        method: method.toUpperCase() as ApiOperation['method'],
        path,
        op,
        access: accessOf(op),
        pathParams: [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!),
        queryParams: (op.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name),
      })),
  );
}

export const isUnsafe = (operation: ApiOperation) => UNSAFE.has(operation.method);

/** The path with every parameter replaced, e.g. by `() => '1'`. */
export function fillPath(path: string, value: (name: string) => string | number): string {
  return path.replace(/\{(\w+)\}/g, (_, name: string) => String(value(name)));
}

export const label = (operation: ApiOperation) =>
  `${operation.method} ${operation.path} (${operation.op.operationId})`;
