import type { DocumentFormat } from '../../core/domain.js';
import { hasDocxBody } from './docx.js';

/**
 * Checks on an uploaded file that need no database (docs/design/documents.md, 2.1–2.3). The file
 * is untrusted: its name, its declared type and its content are all the client's word.
 */

export const ALLOWED_FORMATS: readonly DocumentFormat[] = ['pdf', 'docx', 'txt'];
const MAX_FILE_NAME_CHARACTERS = 255;

/**
 * Control characters, and the marks that make text run right to left (U+202A–U+202E,
 * U+2066–U+2069): "fisier‮txt.exe" would otherwise be shown as a harmless text file.
 */
const UNSAFE_IN_NAME = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}${String.fromCharCode(0x7f)}\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]`,
  'g',
);

/** The last component of a path, without control characters, trimmed (design 2.3). */
export function cleanFileName(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? '';
  return last.replace(UNSAFE_IN_NAME, '').trim();
}

/** The name as stored: at most 255 characters (counted as the database counts them). */
export function storedFileName(cleaned: string): string {
  return Array.from(cleaned).slice(0, MAX_FILE_NAME_CHARACTERS).join('');
}

/** The format an extension names, without regard to case; `null` for anything else. */
export function formatOfName(cleaned: string): DocumentFormat | null {
  const extension = /\.([A-Za-z0-9]+)$/.exec(cleaned)?.[1]?.toLowerCase();
  return ALLOWED_FORMATS.find((format) => format === extension) ?? null;
}

/**
 * Does the content look like the format the extension claims (design 2.2)? It says nothing about
 * whether the file can be read: that is learned at analysis (M06).
 */
export function contentMatchesFormat(format: DocumentFormat, content: Buffer): boolean {
  switch (format) {
    case 'pdf':
      return content.subarray(0, 1024).includes('%PDF-');
    case 'docx':
      return hasDocxBody(content);
    case 'txt': {
      const utf16 =
        (content[0] === 0xff && content[1] === 0xfe) ||
        (content[0] === 0xfe && content[1] === 0xff);
      return utf16 || !content.includes(0);
    }
  }
}

export const CONTENT_TYPES: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};
