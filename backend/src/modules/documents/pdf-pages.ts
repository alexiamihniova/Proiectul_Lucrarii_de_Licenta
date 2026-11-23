import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { PageCountOutcome, PdfPageCounter } from './types.js';

/**
 * Counts the pages of a PDF at upload without extracting its text (design 2.5, Q48).
 *
 * The file is untrusted, so the count runs in a SEPARATE PROCESS that can be killed: a timer
 * kills it when the file takes too long (`timeout`), and the process has a limit on its heap
 * (`--max-old-space-size`); if it runs out, V8 aborts that process and the answer is `memory`.
 * A file that cannot be opened (corrupt, encrypted, not a real PDF) is `unreadable`: the upload
 * goes on and the analysis decides (M06).
 *
 * Why a process and not a thread: measured on hostile files (docs/OPEN_QUESTIONS.md, Q48), a
 * worker thread that exceeds its heap limit sometimes ends with a fatal V8 error that aborts the
 * WHOLE application process, not only the thread. A child process may die without taking the
 * server with it. It costs about the same time (about 0.2–0.4 s for a real file).
 *
 * The code of the child is a string, started with `--eval`, so that it needs no separate file to
 * be found, compiled or copied: it works the same under `tsx`, `vitest` and the compiled build.
 */

/** At most this many counts run at once; the others wait for a turn (their time starts after). */
const MAX_CONCURRENT_COUNTS = 4;

/** How much of the child's error output is kept, to recognise "out of memory". */
const STDERR_KEPT_BYTES = 8 * 1024;

/**
 * Code of the child: read the file from standard input, open it with pdf.js, print the number of
 * pages as JSON. The location of pdf.js comes as the first argument.
 */
const CHILD_SOURCE = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let answer = { kind: 'unreadable' };
try {
  const pdfjs = await import(process.argv[1]);
  const task = pdfjs.getDocument({
    data: new Uint8Array(Buffer.concat(chunks)),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const document = await task.promise;
  answer = { kind: 'pages', pages: document.numPages };
} catch {
  // corrupt, protected or not a PDF
}
process.stdout.write(JSON.stringify(answer));
process.exit(0);
`;

/** Where pdf.js is, as a URL: the child cannot resolve a package name relative to this file. */
const PDFJS_URL = pathToFileURL(
  createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs'),
).href;

function countInProcess(
  content: Buffer,
  limits: { timeoutMs: number; maxMemoryMb: number },
): Promise<PageCountOutcome> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${limits.maxMemoryMb}`,
        '--input-type=module',
        '--eval',
        CHILD_SOURCE,
        PDFJS_URL,
      ],
      // No environment: the child needs nothing from ours, and must not inherit secrets or loaders.
      { stdio: ['pipe', 'pipe', 'pipe'], env: {}, windowsHide: true },
    );

    let settled = false;
    let output = '';
    let errors = '';
    const finish = (outcome: PageCountOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL'); // no-op when it has already ended
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ kind: 'timeout' }), limits.timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (text: string) => {
      if (output.length < 1024) output += text;
    });
    child.stderr.setEncoding('utf8').on('data', (text: string) => {
      if (errors.length < STDERR_KEPT_BYTES) errors += text;
    });
    // The child may die before it has read the whole file (out of memory, killed): not an error.
    child.stdin.on('error', () => undefined);
    child.on('error', () => finish({ kind: 'unreadable' })); // could not even start
    child.on('close', (code, signal) => {
      if (settled) return;
      try {
        const answer = JSON.parse(output) as PageCountOutcome;
        if (answer.kind === 'pages' && Number.isInteger(answer.pages)) return finish(answer);
        if (answer.kind === 'unreadable') return finish(answer);
      } catch {
        // no answer: the child did not finish
      }
      const aborted = signal === 'SIGABRT' || code === 134;
      finish(
        aborted || /out of memory/i.test(errors) ? { kind: 'memory' } : { kind: 'unreadable' },
      );
    });
    child.stdin.end(content);
  });
}

/** The page counter used by the application (a process per file, a few at a time). */
export function createPdfPageCounter(): PdfPageCounter {
  let running = 0;
  const waiting: (() => void)[] = [];
  // The slot is taken at once, not on a later tick: twelve simultaneous calls must not all pass.
  const acquire = (): Promise<void> => {
    if (running < MAX_CONCURRENT_COUNTS) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise<void>((turn) => waiting.push(turn));
  };
  // A waiting call inherits the slot of the one that ends.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  };

  return {
    async count(content, limits) {
      await acquire();
      try {
        return await countInProcess(content, limits);
      } finally {
        release();
      }
    },
  };
}
