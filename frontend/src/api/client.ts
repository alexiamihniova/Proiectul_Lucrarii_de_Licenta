import type { components } from './schema';

/**
 * The only place the frontend calls the backend. Types come from `schema.d.ts`, which is
 * generated from docs/openapi.json (`npm run api:types`) — never written by hand.
 *
 * Requests go to the same origin (`/api/v1/...`, proxied to the backend), so the httpOnly
 * session cookie is sent automatically; the frontend never sees or stores a token.
 */

export const API_PREFIX = '/api/v1';

export type Schemas = components['schemas'];
export type ErrorCode = Schemas['ErrorResponse']['error']['code'];

/** Every failed request becomes an ApiError, whatever went wrong. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Session missing or expired: show the „Sesiune expirată” screen (D15, C-11). */
  get isUnauthenticated(): boolean {
    return this.code === 'UNAUTHENTICATED';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON body, or FormData for the document upload. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_PREFIX}${path}${search ? `?${search}` : ''}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers:
        options.body === undefined || isForm ? undefined : { 'content-type': 'application/json' },
      body:
        options.body === undefined
          ? undefined
          : isForm
            ? (options.body as FormData)
            : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Serverul nu poate fi contactat. Verifică conexiunea.');
  }

  if (response.status === 204 || response.status === 202) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return payload as T;

  const error = (payload as Partial<Schemas['ErrorResponse']> | null)?.error;
  throw new ApiError(
    response.status,
    error?.code ?? 'INTERNAL_ERROR',
    error?.message ?? 'Eroare internă a serverului.',
    error?.details,
  );
}

export function getHealth(signal?: AbortSignal): Promise<Schemas['HealthResponse']> {
  return apiRequest('/health', { signal });
}
