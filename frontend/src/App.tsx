import { useEffect, useState } from 'react';
import { ApiError, getHealth } from './api/client';

type Status = { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; message: string };

/**
 * Foundation placeholder: proves that the browser reaches the backend through the `/api`
 * proxy. Segment 6 replaces it with the real screens (dialog map D1–D15).
 */
export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((health) =>
        setStatus(
          health.status === 'ok'
            ? { kind: 'ok' }
            : { kind: 'error', message: 'Baza de date nu este disponibilă.' },
        ),
      )
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStatus({
          kind: 'error',
          message: error instanceof ApiError ? error.message : 'Eroare necunoscută.',
        });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Recapitulare activă</h1>
      <p>Aplicație web pentru recapitularea activă și adaptată a materialelor universitare.</p>
      <p role="status" aria-live="polite">
        {status.kind === 'loading' && 'Se verifică legătura cu serverul…'}
        {status.kind === 'ok' && 'Serverul și baza de date funcționează.'}
        {status.kind === 'error' && `Serverul nu răspunde: ${status.message}`}
      </p>
    </main>
  );
}
