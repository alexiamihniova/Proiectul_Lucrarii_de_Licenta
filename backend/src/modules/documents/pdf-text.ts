import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { AppError } from '../../core/errors.js';
import type { RawPage } from './types.js';

/**
 * Text of a PDF page, rebuilt from the positions of its fragments (design 3.7): lines from the
 * baseline of each fragment, paragraphs from the vertical gaps, and two columns read one after
 * the other when a clean gutter runs down the page.
 */

/** A fragment of text as pdf.js reports it: where it starts, how wide and how tall it is. */
export interface TextFragment {
  text: string;
  x: number;
  /** Baseline; grows upwards in PDF space. */
  y: number;
  width: number;
  height: number;
}

interface Line {
  y: number;
  height: number;
  text: string;
  /** Left edge, to tell a column from another. */
  x: number;
}

/** Two fragments are on the same line when their baselines differ by less than this × height. */
const SAME_LINE = 0.45;
/** A gap wider than this × height between two fragments is a space. */
const SPACE_GAP = 0.15;
/** A blank line is left when the baselines are further apart than this × the usual spacing. */
const PARAGRAPH_GAP = 1.55;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * The lower quartile: the usual line spacing of a page. A median would be the larger value on a
 * page with few lines and blank-line gaps; the lower quartile is the spacing inside paragraphs.
 */
const lowerQuartile = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 4)] ?? 0;
};

/** The fragments of one block of the page (the whole page, or one column) as lines of text. */
function linesOf(fragments: TextFragment[]): Line[] {
  const ordered = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: TextFragment[][] = [];
  for (const fragment of ordered) {
    const row = rows[rows.length - 1];
    const tolerance = SAME_LINE * Math.max(fragment.height, 1);
    if (row && Math.abs(row[0]!.y - fragment.y) <= tolerance) row.push(fragment);
    else rows.push([fragment]);
  }
  return rows.map((row) => {
    row.sort((a, b) => a.x - b.x);
    let text = '';
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const fragment of row) {
      const gap = fragment.x - previousEnd;
      const needsSpace =
        text !== '' &&
        gap > SPACE_GAP * Math.max(fragment.height, 1) &&
        !text.endsWith(' ') &&
        !fragment.text.startsWith(' ');
      text += (needsSpace ? ' ' : '') + fragment.text;
      previousEnd = fragment.x + fragment.width;
    }
    return {
      y: row[0]!.y,
      height: median(row.map((f) => f.height)),
      text: text.replace(/\s+/g, ' ').trim(),
      x: row[0]!.x,
    };
  });
}

/** Lines in reading order → text with a blank line where the vertical gap says "new paragraph". */
function blockText(fragments: TextFragment[]): string {
  const lines = linesOf(fragments).filter((line) => line.text !== '');
  if (lines.length === 0) return '';
  const spacings = lines.slice(1).map((line, index) => lines[index]!.y - line.y);
  const usual =
    lowerQuartile(spacings.filter((gap) => gap > 0)) ||
    median(lines.map((line) => line.height)) * 1.2;
  let text = lines[0]!.text;
  for (let index = 1; index < lines.length; index += 1) {
    const gap = lines[index - 1]!.y - lines[index]!.y;
    text += (gap > PARAGRAPH_GAP * usual ? '\n\n' : '\n') + lines[index]!.text;
  }
  return text;
}

/**
 * The x of a gutter between two columns, or null. A gutter is a vertical band in the middle part
 * of the text, wider than three lines' height, that no fragment crosses; a title that spans
 * both columns hides it, and the page is then read as one flow.
 */
function gutterOf(fragments: TextFragment[]): number | null {
  const filled = fragments.filter((fragment) => fragment.text.trim() !== '');
  if (filled.length < 8) return null;
  const left = Math.min(...filled.map((fragment) => fragment.x));
  const right = Math.max(...filled.map((fragment) => fragment.x + fragment.width));
  const minimum = 3 * median(filled.map((fragment) => fragment.height));
  const spans = filled
    .map((fragment) => [fragment.x, fragment.x + fragment.width] as const)
    .sort((a, b) => a[0] - b[0]);
  let reach = spans[0]![1];
  for (const [from, to] of spans.slice(1)) {
    if (from - reach >= minimum) {
      const middle = (reach + from) / 2;
      const share = (middle - left) / (right - left);
      if (share > 0.3 && share < 0.7) return middle;
    }
    reach = Math.max(reach, to);
  }
  return null;
}

/** The text of one page, from its fragments. */
export function pageText(fragments: TextFragment[]): string {
  const gutter = gutterOf(fragments);
  if (gutter === null) return blockText(fragments);
  const side = (isLeft: boolean) =>
    blockText(fragments.filter((f) => f.x + f.width / 2 < gutter === isLeft));
  return [side(true), side(false)].filter((column) => column !== '').join('\n\n');
}

// --- reading the file ------------------------------------------------------------------------

/**
 * The file is untrusted, so pdf.js runs in a CHILD PROCESS that can be killed: a page whose
 * contents unpack to gigabytes, or a loop in the parser, would otherwise block or exhaust the
 * process that serves everyone (a timer cannot interrupt synchronous code). The child sends one
 * JSON line per page, with the positioned fragments of its text; the layout (lines, paragraphs,
 * columns) is done here, in `pageText`, which is plain code that needs no isolation.
 */
const CHILD_SOURCE = `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const send = (value) => new Promise((resolve) => process.stdout.write(JSON.stringify(value) + '\\n', resolve));
const maxPages = Number(process.argv[2]);
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
  await send({ pages: document.numPages });
  if (document.numPages > maxPages) process.exit(0);
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const { items } = await page.getTextContent();
    const fragments = [];
    for (const item of items) {
      if (typeof item.str !== 'string' || !item.transform) continue;
      fragments.push([item.str, item.transform[4] ?? 0, item.transform[5] ?? 0, item.width ?? 0,
        item.height || Math.abs(item.transform[3] ?? 0) || 1]);
    }
    await send({ number, fragments });
    page.cleanup();
  }
  await send({ done: true });
  process.exit(0);
} catch {
  process.exit(3); // corrupt, protected or not a PDF
}
`;

const PDFJS_URL = pathToFileURL(
  createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.mjs'),
).href;

/** More than this much output from the child is not a text: it is killed (a hostile file). */
const MAX_CHILD_OUTPUT_BYTES = 256 * 1024 * 1024;

export interface PdfReadOptions {
  /** Heap limit of the child process, in MB (`--max-old-space-size`). */
  memoryMb: number;
  /** A PDF with more pages is refused before any text is read: `FILE_TOO_LARGE`. */
  maxPages: number;
}

type ChildLine =
  | { pages: number }
  | { number: number; fragments: [string, number, number, number, number][] }
  | { done: true };

/**
 * The pages of a PDF as text. `TEXT_NOT_EXTRACTABLE` for a file that cannot be opened (corrupt,
 * protected by a password), cannot be read within the memory limit or is stopped; the work ends
 * when `signal` is aborted (the child is killed).
 */
export function readPdfPages(
  content: Buffer,
  signal: AbortSignal,
  options: PdfReadOptions,
): Promise<RawPage[]> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${options.memoryMb}`,
        '--input-type=module',
        '--eval',
        CHILD_SOURCE,
        PDFJS_URL,
        String(options.maxPages),
      ],
      // No environment: the child needs nothing from ours, and must not inherit secrets or loaders.
      { stdio: ['pipe', 'pipe', 'ignore'], env: {}, windowsHide: true },
    );

    let settled = false;
    let declaredPages: number | null = null;
    let finished = false;
    let received = 0;
    let buffered = '';
    const pages: RawPage[] = [];
    const end = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      child.kill('SIGKILL'); // no-op when it has already ended
      outcome();
    };
    const fail = () => end(() => reject(new AppError('TEXT_NOT_EXTRACTABLE')));
    const onAbort = () => end(() => reject(signal.reason as Error));
    signal.addEventListener('abort', onAbort, { once: true });

    const handle = (line: ChildLine) => {
      if ('pages' in line) {
        declaredPages = line.pages;
        if (line.pages > options.maxPages) {
          end(() =>
            reject(
              new AppError('FILE_TOO_LARGE', {
                exceeded: 'pages',
                limit_pages: options.maxPages,
                pages: line.pages,
              }),
            ),
          );
        }
      } else if ('fragments' in line) {
        pages.push({
          number: line.number,
          text: pageText(
            line.fragments.map(([text, x, y, width, height]) => ({ text, x, y, width, height })),
          ),
        });
      } else {
        finished = true;
      }
    };

    child.stdout.setEncoding('utf8').on('data', (text: string) => {
      received += text.length;
      if (received > MAX_CHILD_OUTPUT_BYTES) return fail();
      buffered += text;
      for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
        const line = buffered.slice(0, at);
        buffered = buffered.slice(at + 1);
        try {
          handle(JSON.parse(line) as ChildLine);
        } catch {
          return fail();
        }
      }
    });
    child.stdin.on('error', () => undefined); // the child may die before it has read the file
    child.on('error', fail);
    child.on('close', () => {
      if (finished && declaredPages === pages.length) end(() => resolve(pages));
      else fail();
    });
    child.stdin.end(content);
  });
}
