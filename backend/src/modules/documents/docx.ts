import { inflateRawSync } from 'node:zlib';
import { AppError } from '../../core/errors.js';

/**
 * Reads the text of a .docx file (design 3.7) without a library: a .docx is a ZIP archive whose
 * body is `word/document.xml`, and the text of that part is in `<w:t>` elements inside `<w:p>`
 * paragraphs. Headers, footers, notes and comments are other parts and are never read; deleted
 * text (`<w:delText>`) is not `<w:t>` and does not appear.
 *
 * The file is untrusted: the archive is read from its central directory, the part is inflated
 * with a limit on its size (a "ZIP bomb" must not fill the memory), and anything unexpected
 * is `TEXT_NOT_EXTRACTABLE`.
 */

/** The unpacked `word/document.xml` may not exceed this (design 3.7). */
export const MAX_DOCUMENT_XML_BYTES = 100 * 1024 * 1024;

const BODY_PART = 'word/document.xml';
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

const notExtractable = () => new AppError('TEXT_NOT_EXTRACTABLE');

interface ZipEntry {
  method: number;
  compressedSize: number;
  localHeader: number;
}

/** Looks one entry up in the central directory, without reading its data. Null if there is none. */
function findEntry(archive: Buffer, wanted: string): ZipEntry | null {
  // The end-of-central-directory record is within the last 64 KB + 22 bytes of the file.
  const earliest = Math.max(0, archive.length - 22 - 0xffff);
  let end = -1;
  for (let at = archive.length - 22; at >= earliest; at -= 1) {
    if (archive.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;

  const entries = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  for (let entry = 0; entry < entries; entry += 1) {
    if (at + 46 > archive.length || archive.readUInt32LE(at) !== CENTRAL_DIRECTORY_ENTRY)
      return null;
    const nameLength = archive.readUInt16LE(at + 28);
    const name = archive.toString('utf8', at + 46, at + 46 + nameLength);
    const found = {
      method: archive.readUInt16LE(at + 10),
      compressedSize: archive.readUInt32LE(at + 20),
      localHeader: archive.readUInt32LE(at + 42),
    };
    at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
    if (name === wanted) return found;
  }
  return null;
}

/** The bytes of one part of the archive, unpacked. Throws `TEXT_NOT_EXTRACTABLE`. */
function readPart(archive: Buffer, wanted: string, maxBytes: number): Buffer {
  const entry = findEntry(archive, wanted);
  if (!entry) throw notExtractable();
  const { method, compressedSize, localHeader } = entry;
  if (
    localHeader + 30 > archive.length ||
    archive.readUInt32LE(localHeader) !== LOCAL_FILE_HEADER
  ) {
    throw notExtractable();
  }
  const dataStart =
    localHeader +
    30 +
    archive.readUInt16LE(localHeader + 26) +
    archive.readUInt16LE(localHeader + 28);
  if (dataStart + compressedSize > archive.length) throw notExtractable();
  const packed = archive.subarray(dataStart, dataStart + compressedSize);
  if (method === 0) {
    if (packed.length > maxBytes) throw notExtractable();
    return packed;
  }
  if (method !== 8) throw notExtractable();
  try {
    return inflateRawSync(packed, { maxOutputLength: maxBytes });
  } catch {
    throw notExtractable(); // corrupt data, or more than the limit
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x')) return safeCodePoint(parseInt(name.slice(2), 16), whole);
    if (name.startsWith('#')) return safeCodePoint(parseInt(name.slice(1), 10), whole);
    return XML_ENTITIES[name] ?? whole;
  });
}

function safeCodePoint(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

/** The text of one `<w:p>…</w:p>`: its `<w:t>` runs, with tabs and line breaks as in Word. */
function paragraphText(xml: string): string {
  let text = '';
  const pieces =
    /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;
  for (const piece of xml.matchAll(pieces)) {
    if (piece[0].startsWith('<w:t>') || piece[0].startsWith('<w:t '))
      text += decodeEntities(piece[1] ?? '');
    else if (piece[0].startsWith('<w:tab')) text += ' ';
    else if (piece[0].startsWith('<w:br') || piece[0].startsWith('<w:cr')) text += '\n';
  }
  return text;
}

/**
 * The paragraphs of the document body, in order, tables included (each cell paragraph is one),
 * separated by a blank line so the structuring step sees them as paragraphs.
 */
export function readDocxText(archive: Buffer): string {
  if (archive.length < 22 || archive.readUInt32LE(0) !== LOCAL_FILE_HEADER) throw notExtractable();
  const xml = readPart(archive, BODY_PART, MAX_DOCUMENT_XML_BYTES).toString('utf8');
  if (!/<w:document[\s>]/.test(xml)) throw notExtractable();
  const paragraphs: string[] = [];
  for (const paragraph of xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const text = paragraphText(paragraph[1]!);
    if (text.trim() !== '') paragraphs.push(text);
  }
  return paragraphs.join('\n\n');
}

/** For the content check at upload (design 2.2): a ZIP archive that holds `word/document.xml`. */
export function hasDocxBody(archive: Buffer): boolean {
  if (archive.length < 22 || archive.readUInt32LE(0) !== LOCAL_FILE_HEADER) return false;
  try {
    return findEntry(archive, BODY_PART) !== null;
  } catch {
    return false;
  }
}
