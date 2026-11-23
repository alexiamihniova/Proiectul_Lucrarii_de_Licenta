import { AppError } from '../../core/errors.js';
import {
  CHARACTERS_PER_PAGE,
  MIN_TEXT_LENGTH,
  PASSAGE_MAX_WORDS,
  PASSAGE_MIN_WORDS,
} from './types.js';
import type { ExtractedText, PassageRecord, SentenceRecord, StructuredText } from './types.js';

/**
 * Turns the pages read from a file into structured text: cleaned paragraphs, sentences and
 * passages, all with their positions in the canonical text (docs/design/documents.md, 3.2–3.6;
 * ADR-0013). PURE: no file, no database, no clock; the same pages give the same structure.
 */

// --- words -----------------------------------------------------------------------------------

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** A word is a run of non-space characters with at least one letter or digit (design 3.4). */
export function countWords(text: string): number {
  let words = 0;
  for (const token of text.split(/\s+/)) if (HAS_LETTER_OR_DIGIT.test(token)) words += 1;
  return words;
}

// --- 3.3 cleaning ----------------------------------------------------------------------------

/** NUL and the soft hyphen go; every run of spaces (tab and no-break space too) becomes one. */
const NUL_AND_SOFT_HYPHEN = new RegExp(
  `[${String.fromCharCode(0)}${String.fromCharCode(0xad)}]`,
  'g',
);

function cleanLine(line: string): string {
  return line.replace(NUL_AND_SOFT_HYPHEN, '').replace(/\s+/g, ' ').trim();
}

/** "12", "Pagina 12", "pag. 12", "– 12 –", "12 / 40", "12 din 40". */
const PAGE_NUMBER = /^(pag(ina|e)?\.?\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(\s*(din|of|\/)\s*\d{1,4})?$/i;

/** Lower case, digits replaced: "Curs 3 – pagina 12" and "Curs 3 – pagina 13" are the same line. */
const repetitionKey = (line: string) => line.toLowerCase().replace(/\d+/g, '#');

const EDGE_LINES = 2;
const MIN_PAGES_FOR_EDGES = 3;

/** Indexes of the first and last non-empty lines of a page that may be a header or a footer. */
function edgeLines(lines: string[]): Set<number> {
  const filled = lines.flatMap((line, index) => (line ? [index] : []));
  // On short pages the margins examined do not exceed a third of the lines.
  const each = Math.min(EDGE_LINES, Math.floor(filled.length / 3));
  if (each === 0) return new Set();
  return new Set([...filled.slice(0, each), ...filled.slice(-each)]);
}

/** Removes page numbers and lines repeated on half the pages (at least 3) from the page edges. */
function removeRepeatedEdges(pages: string[][]): string[][] {
  const pagesWithKey = new Map<string, number>();
  for (const lines of pages) {
    const keys = new Set([...edgeLines(lines)].map((index) => repetitionKey(lines[index]!)));
    for (const key of keys) pagesWithKey.set(key, (pagesWithKey.get(key) ?? 0) + 1);
  }
  const threshold = Math.max(MIN_PAGES_FOR_EDGES, Math.ceil(pages.length / 2));
  return pages.map((lines) => {
    const edges = edgeLines(lines);
    return lines.filter((line, index) => {
      if (!edges.has(index)) return true;
      if (PAGE_NUMBER.test(line)) return false;
      return (pagesWithKey.get(repetitionKey(line)) ?? 0) < threshold;
    });
  });
}

/** Joins the lines of one paragraph; "într-" + "o" becomes "într-o", the rest gets a space. */
function joinLines(lines: string[]): string {
  let joined = '';
  for (const line of lines) {
    if (joined === '') joined = line;
    else joined += hyphenContinues(joined, line) ? line : ` ${line}`;
  }
  return joined;
}

function hyphenContinues(before: string, after: string): boolean {
  return /\p{L}-$/u.test(before) && /^\p{Ll}/u.test(after);
}

/** The paragraph ended its sentence: `. ! ? … : ;`, maybe followed by closing quotes or brackets. */
const ENDS_SENTENCE = /[.!?…:;]["”»)\]]*$/;

interface Paragraph {
  text: string;
  /** Where, in `text`, the part that was on each page begins. */
  pageStarts: { offset: number; page: number }[];
}

/** The paragraphs of the pages: blocks of lines, continued across a page when the text asks for it. */
function paragraphsOf(pages: { number: number; lines: string[] }[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let carry: Paragraph | null = null; // last paragraph of the previous page, which may continue

  for (const page of pages) {
    const blocks: string[][] = [];
    let block: string[] = [];
    for (const line of page.lines) {
      if (line) block.push(line);
      else if (block.length > 0) {
        blocks.push(block);
        block = [];
      }
    }
    if (block.length > 0) blocks.push(block);

    let last: Paragraph | null = null;
    let first = true;
    for (const lines of blocks) {
      const text = joinLines(lines);
      if (!HAS_LETTER_OR_DIGIT.test(text)) continue; // a separator, a lone symbol: not text
      if (first && carry && !ENDS_SENTENCE.test(carry.text) && /^\p{Ll}/u.test(text)) {
        const glue = hyphenContinues(carry.text, text) ? '' : ' ';
        carry.pageStarts.push({ offset: carry.text.length + glue.length, page: page.number });
        carry.text += glue + text;
        last = carry;
      } else {
        last = { text, pageStarts: [{ offset: 0, page: page.number }] };
        paragraphs.push(last);
      }
      first = false;
    }
    carry = last; // an empty page ends every continuation
  }
  return paragraphs;
}

// --- 3.4 sentences ---------------------------------------------------------------------------

/** After these, a period never ends the sentence (design 3.4); lower case, no final period. */
const ABBREVIATIONS = new Set([
  'prof', 'dr', 'ing', 'conf', 'lect', 'acad', 'dl', 'dna', 'd-na', 'd-l', 'nr', 'art', 'alin',
  'lit', 'pag', 'p', 'fig', 'tab', 'cap', 'vol', 'ed', 'ex', 'etc', 'cf', 'vs', 'aprox', 'str',
  'tel', 'sec', 'min', 'max', 'ș.a', 'ș.a.m.d', 'a.m.d', 'd.e', 'î.e.n', 'e.n', 'i.e', 'e.g',
]); // prettier-ignore

/** These end a sentence anyway when a capital letter follows ("… arbori etc. Fiecare …"). */
const ABBREVIATIONS_THAT_MAY_END = new Set(['etc', 'ș.a', 'ș.a.m.d', 'a.m.d']);

/**
 * A boundary: terminator(s), optional closing marks, spaces, then a capital letter, a digit or an
 * opening mark. Groups: 1 = the terminators, 2 = what is kept with the sentence, 3 = the spaces.
 */
const BOUNDARY = /([.!?…]+)(["”»)\]]*)(\s+)(?=[\p{Lu}\d„"«([–—])/gu;

/** [start, end) of each sentence of one paragraph, without the spaces between them. */
function sentenceSpans(paragraph: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = 0;
  BOUNDARY.lastIndex = 0;
  for (let match = BOUNDARY.exec(paragraph); match; match = BOUNDARY.exec(paragraph)) {
    const terminators = match[1]!;
    const end = match.index + terminators.length + match[2]!.length;
    if (
      terminators === '.' &&
      continuesAfterPeriod(paragraph, start, match.index, end + match[3]!.length)
    ) {
      continue;
    }
    spans.push([start, end]);
    start = end + match[3]!.length;
  }
  if (start < paragraph.length) spans.push([start, paragraph.length]);
  return spans.flatMap(([from, to]) => splitLongSentence(paragraph, from, to));
}

/** True when the period at `periodAt` does not end the sentence that began at `sentenceStart`. */
function continuesAfterPeriod(
  paragraph: string,
  sentenceStart: number,
  periodAt: number,
  nextAt: number,
): boolean {
  const token = /\S+$/.exec(paragraph.slice(sentenceStart, periodAt))?.[0] ?? '';
  const word = token.replace(/^[(„"«[]+/, '');
  const next = paragraph[nextAt] ?? '';
  const lower = word.toLowerCase();
  if (ABBREVIATIONS.has(lower)) {
    return !(ABBREVIATIONS_THAT_MAY_END.has(lower) && /^\p{Lu}$/u.test(next));
  }
  if (/^\p{Lu}$/u.test(word)) return true; // an initial: "I. L. Caragiale"
  return /\d$/.test(word) && /^\d/.test(next); // between two digits
}

/** A sentence of more than 300 words is cut, at word boundaries, into pieces of at most 300. */
function splitLongSentence(paragraph: string, from: number, to: number): [number, number][] {
  const sentence = paragraph.slice(from, to);
  if (countWords(sentence) <= PASSAGE_MAX_WORDS) return [[from, to]];
  const pieces: [number, number][] = [];
  let pieceStart = -1;
  let pieceEnd = -1;
  let words = 0;
  for (const token of sentence.matchAll(/\S+/g)) {
    const isWord = HAS_LETTER_OR_DIGIT.test(token[0]);
    if (isWord && words === PASSAGE_MAX_WORDS) {
      pieces.push([from + pieceStart, from + pieceEnd]);
      pieceStart = -1;
      words = 0;
    }
    if (pieceStart < 0) pieceStart = token.index;
    pieceEnd = token.index + token[0].length;
    if (isWord) words += 1;
  }
  pieces.push([from + pieceStart, from + pieceEnd]);
  return pieces;
}

// --- the whole structure ---------------------------------------------------------------------

export function structureText(
  extracted: ExtractedText,
  options: { maxPages: number },
): StructuredText {
  const tooManyPages = (pages: number) =>
    new AppError('FILE_TOO_LARGE', { exceeded: 'pages', limit_pages: options.maxPages, pages });
  // A file with real pages may already be over the limit, with or without text on them.
  if (extracted.paged && extracted.pages.length > options.maxPages) {
    throw tooManyPages(extracted.pages.length);
  }

  let pages = extracted.pages.map((page) => ({
    number: page.number,
    lines: page.text.replace(/\r\n?/g, '\n').split('\n').map(cleanLine),
  }));
  if (extracted.paged && pages.length >= MIN_PAGES_FOR_EDGES) {
    const withoutEdges = removeRepeatedEdges(pages.map((page) => page.lines));
    pages = pages.map((page, index) => ({ number: page.number, lines: withoutEdges[index]! }));
  }

  // Sentences, and where each one starts, in the canonical text.
  let text = '';
  const sentences: SentenceRecord[] = [];
  const endsParagraph: boolean[] = [];
  const paragraphs = paragraphsOf(pages);
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    if (paragraphIndex > 0) text += '\n\n';
    const spans = sentenceSpans(paragraph.text);
    for (const [spanIndex, [from, to]] of spans.entries()) {
      if (spanIndex > 0) text += ' ';
      const sentence = paragraph.text.slice(from, to);
      const startedOn = [...paragraph.pageStarts].reverse().find((part) => part.offset <= from)!;
      sentences.push({
        position: sentences.length,
        paragraph: paragraphIndex,
        page: startedOn.page,
        startOffset: text.length,
        endOffset: text.length + sentence.length,
        text: sentence,
        passagePosition: 0,
      });
      endsParagraph.push(spanIndex === spans.length - 1);
      text += sentence;
    }
  }
  if (text.length < MIN_TEXT_LENGTH) throw new AppError('TEXT_NOT_EXTRACTABLE');

  let pageCount = extracted.pages.length;
  if (!extracted.paged) {
    // No real pages (Q16): one "page" per 3000 characters of canonical text.
    pageCount = Math.max(1, Math.ceil(text.length / CHARACTERS_PER_PAGE));
    if (pageCount > options.maxPages) throw tooManyPages(pageCount);
    for (const sentence of sentences) {
      sentence.page = Math.floor(sentence.startOffset / CHARACTERS_PER_PAGE) + 1;
    }
  }

  return { text, pageCount, sentences, passages: passagesOf(text, sentences, endsParagraph) };
}

// --- 3.5 passages ----------------------------------------------------------------------------

/** Groups whole sentences into passages of 100–300 words and sets `passagePosition` on each. */
function passagesOf(
  text: string,
  sentences: SentenceRecord[],
  endsParagraph: boolean[],
): PassageRecord[] {
  const words = sentences.map((sentence) => countWords(sentence.text));
  const groups: number[][] = [];
  let current: number[] = [];
  let currentWords = 0;
  for (const sentence of sentences) {
    const own = words[sentence.position]!;
    // 1. The next sentence would take the passage over 300 words: close it before the sentence.
    if (current.length > 0 && currentWords + own > PASSAGE_MAX_WORDS) {
      groups.push(current);
      current = [];
      currentWords = 0;
    }
    current.push(sentence.position);
    currentWords += own;
    // 2. 100 words or more and the paragraph ends here: close the passage.
    if (currentWords >= PASSAGE_MIN_WORDS && endsParagraph[sentence.position]) {
      groups.push(current);
      current = [];
      currentWords = 0;
    }
  }
  if (current.length > 0) groups.push(current);

  // 3. A last passage under 100 words joins the one before it when both fit in 300 words.
  const wordsOf = (group: number[]) => group.reduce((sum, index) => sum + words[index]!, 0);
  if (groups.length >= 2) {
    const last = groups[groups.length - 1]!;
    const before = groups[groups.length - 2]!;
    if (wordsOf(last) < PASSAGE_MIN_WORDS && wordsOf(last) + wordsOf(before) <= PASSAGE_MAX_WORDS) {
      groups.splice(-2, 2, [...before, ...last]);
    }
  }

  return groups.map((group, position) => {
    const first = sentences[group[0]!]!;
    const last = sentences[group[group.length - 1]!]!;
    for (const index of group) sentences[index]!.passagePosition = position;
    return {
      position,
      page: first.page,
      startOffset: first.startOffset,
      endOffset: last.endOffset,
      text: text.slice(first.startOffset, last.endOffset),
      firstSentence: first.position,
      lastSentence: last.position,
    };
  });
}
