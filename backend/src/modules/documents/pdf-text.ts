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

interface PdfItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
}

type PdfDocument = {
  numPages: number;
  getPage(number: number): Promise<{
    getTextContent(): Promise<{ items: PdfItem[] }>;
    cleanup(): void;
  }>;
};

/** What pdf.js is given to open a file: no eval, no fonts to load, nothing to run. */
export const PDF_OPEN_OPTIONS = {
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  verbosity: 0,
} as const;

/**
 * The pages of a PDF as text. `TEXT_NOT_EXTRACTABLE` for a file that cannot be opened (corrupt,
 * protected by a password) or read. Stops between pages when `signal` is aborted.
 */
export async function readPdfPages(content: Buffer, signal: AbortSignal): Promise<RawPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(content), ...PDF_OPEN_OPTIONS });
  try {
    const document = (await task.promise.catch(() => {
      throw new AppError('TEXT_NOT_EXTRACTABLE');
    })) as unknown as PdfDocument;
    const pages: RawPage[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      signal.throwIfAborted();
      const page = await document.getPage(number);
      const { items } = await page.getTextContent();
      const fragments: TextFragment[] = items.flatMap((item) =>
        typeof item.str === 'string' && item.transform
          ? [
              {
                text: item.str,
                x: item.transform[4] ?? 0,
                y: item.transform[5] ?? 0,
                width: item.width ?? 0,
                height: item.height || Math.abs(item.transform[3] ?? 0) || 1,
              },
            ]
          : [],
      );
      pages.push({ number, text: pageText(fragments) });
      page.cleanup();
    }
    return pages;
  } catch (error) {
    if (error instanceof AppError || signal.aborted) throw error;
    throw new AppError('TEXT_NOT_EXTRACTABLE');
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
