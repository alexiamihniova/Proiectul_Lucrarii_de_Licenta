import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, getHealth } from './client';

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the same-origin /api/v1 prefix and returns the JSON body', async () => {
    const fetchMock = mockFetch(200, { status: 'ok', database: 'connected', uptime_seconds: 3 });
    await expect(getHealth()).resolves.toMatchObject({ status: 'ok' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/health');
    expect(init.credentials).toBe('same-origin');
  });

  it('serialises the query string and the JSON body', async () => {
    const fetchMock = mockFetch(201, { id: 1 });
    await apiRequest('/subjects', {
      method: 'POST',
      body: { name: 'BD' },
      query: { page: 2, skip: undefined },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/subjects?page=2');
    expect(init.body).toBe('{"name":"BD"}');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('turns the error format of the API into an ApiError', async () => {
    mockFetch(501, {
      error: { code: 'NOT_IMPLEMENTED', message: 'Funcționalitatea nu este încă implementată.' },
    });
    const error = await apiRequest('/subjects').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });
  });

  it('keeps the details of a validation error', async () => {
    mockFetch(400, {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'x',
        details: [{ path: 'body/name', message: 'y' }],
      },
    });
    const error = (await apiRequest('/subjects', { method: 'POST', body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(error.details).toEqual([{ path: 'body/name', message: 'y' }]);
  });

  it('recognises an expired session (D15)', async () => {
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    const error = (await apiRequest('/auth/me').catch((e: unknown) => e)) as ApiError;
    expect(error.isUnauthenticated).toBe(true);
  });

  it('returns undefined for 204 No Content', async () => {
    mockFetch(204, undefined);
    await expect(apiRequest('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('reports a network failure as an ApiError too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))),
    );
    await expect(getHealth()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});
