import { AppError } from '../../core/errors.js';
import { readDocxText } from './docx.js';
import { readPdfPages } from './pdf-text.js';
import type { ExtractedText, TextExtractor } from './types.js';

/**
 * The default `TextExtractor` (design 3.7): PDF, DOCX and TXT. The file is untrusted; every
 * failure to read it is `TEXT_NOT_EXTRACTABLE` (M06), and `signal` stops the work.
 */

/** UTF-8 with or without a mark, UTF-16 with a mark, else Windows-1250 (old Romanian files). */
export function decodeText(content: Buffer): string {
  if (content[0] === 0xff && content[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(content);
  if (content[0] === 0xfe && content[1] === 0xff)
    return new TextDecoder('utf-16be').decode(content);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content); // the BOM is dropped
  } catch {
    return new TextDecoder('windows-1250').decode(content);
  }
}

export function createTextExtractor(): TextExtractor {
  return {
    async extract({ format, content }, signal): Promise<ExtractedText> {
      signal.throwIfAborted();
      if (format === 'txt') {
        return { paged: false, pages: [{ number: 1, text: decodeText(content) }] };
      }
      if (format === 'docx') {
        return { paged: false, pages: [{ number: 1, text: readDocxText(content) }] };
      }
      if (format === 'pdf') return { paged: true, pages: await readPdfPages(content, signal) };
      throw new AppError('UNSUPPORTED_FILE_FORMAT');
    },
  };
}
