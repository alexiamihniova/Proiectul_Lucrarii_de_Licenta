import { readFileSync } from 'node:fs';
import { createPdfPageCounter } from '../../src/modules/documents/service.js';
import { asciiProse, docx, multipart, pdf, prose, txt, wrap } from '../helpers/fixtures.js';

/**
 * Checks, against a RUNNING application (API and worker), that a document goes from "queued" to
 * "ready" by itself: a TXT, a DOCX and a PDF, each within 5 s of the upload (C-02), and that the
 * child process that counts the pages of a PDF works on this machine (in Compose: on Alpine).
 *
 * Every file is generated here; nothing real is committed or needed. The student it creates is
 * deleted at the end. Run it from the repository root against the Compose stack:
 *
 *   make up && make verify-worker
 *
 * or, without Docker, with the API and the worker started by `make dev`:
 *
 *   API_URL=http://localhost:3001/api/v1 npx --prefix backend tsx backend/tests/e2e/verify-worker.ts
 *
 * Exit code 0: everything held. 1: what did not, said on standard error.
 */

const API = process.env.API_URL ?? 'http://localhost:3001/api/v1';
/** C-02: the state of a document reaches the interface within 5 s of the change. */
const WITHIN_MS = 5000;
const POLL_MS = 200;
const PASSWORD = 'parola-de-verificare-1';

const say = (line: string) => void process.stdout.write(`${line}\n`);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class Failure extends Error {}
function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Failure(message);
}

interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  cookie: string | undefined;
}

async function call(
  path: string,
  init: {
    method?: string;
    json?: unknown;
    cookie?: string;
    raw?: { headers: Record<string, string>; payload: Buffer };
  } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.cookie ? { cookie: init.cookie } : {}) };
  let body: Uint8Array | string | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.raw) {
    Object.assign(headers, init.raw.headers);
    body = new Uint8Array(init.raw.payload);
  }
  const response = await fetch(`${API}${path}`, { method: init.method ?? 'GET', headers, body });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    cookie: response.headers.getSetCookie()[0]?.split(';')[0],
  };
}

/** A DOCX, a TXT and a PDF with enough text to be readable (RF4: at least 200 characters). */
const SAMPLES = [
  { fileName: 'verificare.txt', format: 'txt', content: txt(prose(6)) },
  { fileName: 'verificare.docx', format: 'docx', content: docx(prose(4).split('\n\n')) },
  {
    fileName: 'verificare.pdf',
    format: 'pdf',
    content: pdf([wrap(asciiProse(3)), wrap(asciiProse(3, 5, 9))]),
  },
] as const;

async function main(): Promise<void> {
  const platform = (() => {
    try {
      return (
        /^PRETTY_NAME="?([^"\n]*)/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1] ??
        process.platform
      );
    } catch {
      return process.platform;
    }
  })();
  say(`machine: ${platform}, Node ${process.version}, API ${API}`);

  // --- the child process that counts the pages of a PDF, on THIS machine ----------------------
  const counter = createPdfPageCounter();
  const limits = { timeoutMs: 20_000, maxMemoryMb: 256 };
  const counted = await counter.count(SAMPLES[2].content, limits);
  must(
    counted.kind === 'pages' && counted.pages === 2,
    `the page counter said ${JSON.stringify(counted)}, not 2 pages`,
  );
  const garbage = await counter.count(Buffer.from('%PDF-1.4 nu este un pdf'), limits);
  must(
    garbage.kind === 'unreadable',
    `the page counter said ${JSON.stringify(garbage)} for a corrupt file`,
  );
  say('ok  the child process counts the pages of a PDF (2), and calls a corrupt one unreadable');

  // --- a student, a subject ---------------------------------------------------------------------
  const email = `verificare-${Date.now()}@example.com`;
  const registered = await call('/auth/register', {
    method: 'POST',
    json: { email, password: PASSWORD, password_confirmation: PASSWORD, gdpr_consent: true },
  });
  must(
    registered.status === 201 && registered.cookie,
    `registration answered ${registered.status}`,
  );
  const cookie = registered.cookie;
  try {
    const subject = await call('/subjects', {
      method: 'POST',
      json: { name: 'Verificare' },
      cookie,
    });
    must(subject.status === 201, `creating the subject answered ${subject.status}`);

    // --- each document, from the queue to "ready" ---------------------------------------------
    for (const sample of SAMPLES) {
      const started = Date.now();
      const uploaded = await call(`/subjects/${subject.body.id}/documents`, {
        method: 'POST',
        cookie,
        raw: multipart({ fileName: sample.fileName, content: sample.content }),
      });
      must(
        uploaded.status === 201,
        `${sample.format}: the upload answered ${uploaded.status}: ${JSON.stringify(uploaded.body)}`,
      );
      must(
        uploaded.body.format === sample.format,
        `${sample.format}: stored as ${uploaded.body.format}`,
      );

      let document = uploaded.body;
      while (document.status === 'queued' || document.status === 'processing') {
        must(
          Date.now() - started <= WITHIN_MS,
          `${sample.format}: still "${document.status}" after ${WITHIN_MS} ms (C-02)`,
        );
        await wait(POLL_MS);
        document = (await call(`/documents/${document.id}`, { cookie })).body;
      }
      const took = Date.now() - started;
      must(
        document.status === 'ready',
        `${sample.format}: ended "${document.status}" (${JSON.stringify(document.error)})`,
      );
      must(
        took <= WITHIN_MS,
        `${sample.format}: ready after ${took} ms, over ${WITHIN_MS} ms (C-02)`,
      );
      must(document.page_count >= 1, `${sample.format}: no page count`);

      const passages = await call(`/documents/${document.id}/passages`, { cookie });
      must(
        passages.status === 200 && passages.body.total >= 1,
        `${sample.format}: no passage was stored`,
      );
      say(
        `ok  ${sample.format.padEnd(4)} queued -> ready in ${String(took).padStart(4)} ms, ${document.page_count} page(s), ${passages.body.total} passage(s)`,
      );
    }
  } finally {
    // Whatever happened, the student and their files go (RF20, Q43).
    const deleted = await call('/account/delete', {
      method: 'POST',
      json: { password: PASSWORD },
      cookie,
    });
    say(
      deleted.status === 204
        ? 'ok  the verification account was deleted'
        : `!!  could not delete the verification account (${deleted.status})`,
    );
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(`FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
