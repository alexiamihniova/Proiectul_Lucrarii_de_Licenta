import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('App', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows that the server is reachable', async () => {
    stubFetch(200, { status: 'ok', database: 'connected', uptime_seconds: 1 });
    render(<App />);
    expect(await screen.findByText('Serverul și baza de date funcționează.')).toBeDefined();
  });

  it('shows the error message when the server fails', async () => {
    stubFetch(500, { error: { code: 'INTERNAL_ERROR', message: 'Eroare internă a serverului.' } });
    render(<App />);
    expect(
      await screen.findByText(/Serverul nu răspunde: Eroare internă a serverului\./),
    ).toBeDefined();
  });
});
