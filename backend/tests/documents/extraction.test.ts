import { describe, expect, it } from 'vitest';
import { createTextExtractor, structureText } from '../../src/modules/documents/service.js';
import type { DocumentFormat } from '../../src/core/domain.js';
import { asciiProse, docx, pdf, prose, sentence, txt, wrap, zip } from '../helpers/fixtures.js';
import { expectValidStructure } from '../helpers/structure.js';

/** RF4 — reading PDF, DOCX and TXT files. Design: section 3.7. No database is involved. */
const signal = () => new AbortController().signal;
const extract = (format: DocumentFormat, content: Buffer) =>
  createTextExtractor().extract({ format, content }, signal());
const allText = async (format: DocumentFormat, content: Buffer) =>
  (await extract(format, content)).pages.map((page) => page.text).join('\n');
const notExtractable = expect.objectContaining({ code: 'TEXT_NOT_EXTRACTABLE' });

describe('text extraction (RF4)', () => {
  describe('TXT', () => {
    const text = `${prose(2)}\n\nLiterele românești: ă â î ș ț Ă Â Î Ș Ț.`;

    it('is one unpaged page with the text unchanged', async () => {
      const result = await extract('txt', txt(text));
      expect(result.paged).toBe(false);
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0]).toMatchObject({ number: 1 });
      expect(result.pages[0]!.text.replaceAll('\r\n', '\n')).toBe(text);
    });

    it.each([
      ['UTF-8 with a byte order mark', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), txt(text)])],
      [
        'UTF-16 little endian',
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
      ],
      [
        'UTF-16 big endian',
        Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]),
      ],
    ])('reads %s, without the mark', async (_name, content) => {
      const read = await allText('txt', content);
      expect(read).toContain('Literele românești: ă â î ș ț Ă Â Î Ș Ț.');
      expect(read.charCodeAt(0)).not.toBe(0xfeff);
    });

    it('reads an old Windows-1250 file', async () => {
      // "ţară şi înălţime" in Windows-1250: ţ = 0xFE, ă = 0xE3, ş = 0xBA, î = 0xEE.
      const bytes = Buffer.from([
        0xfe, 0x61, 0x72, 0xe3, 0x20, 0xba, 0x69, 0x20, 0xee, 0x6e, 0xe3, 0x6c, 0xfe, 0x69, 0x6d,
        0x65,
      ]);
      expect(await allText('txt', bytes)).toBe('ţară şi înălţime');
    });
  });

  describe('DOCX', () => {
    const paragraphs = [
      'Titlul documentului',
      sentence(14, 1),
      `${sentence(9, 2)} ${sentence(9, 3)}`,
      'Diacritice: ă â î ș ț.',
    ];

    it('is unpaged and keeps the paragraphs, in order', async () => {
      const result = await extract('docx', docx(paragraphs));
      expect(result.paged).toBe(false);
      const read = result.pages.map((page) => page.text).join('\n\n');
      const found = read
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      expect(found).toEqual(paragraphs);
    });

    it('decodes XML entities', async () => {
      const read = await allText('docx', docx(['Dacă a < b & b > c, atunci a < c.']));
      expect(read).toContain('Dacă a < b & b > c, atunci a < c.');
    });

    it('gives a valid structure with one paragraph per Word paragraph', async () => {
      const body = Array.from(
        { length: 20 },
        (_, i) => `${sentence(10, i)} ${sentence(10, i + 50)}`,
      );
      const structure = structureText(await extract('docx', docx(body)), { maxPages: 100 });
      expectValidStructure(structure);
      expect(structure.text).toBe(body.join('\n\n'));
    });

    it.each([
      ['an archive cut in half', docx(paragraphs).subarray(0, 200)],
      ['an archive without word/document.xml', zip([{ name: 'word/styles.xml', content: '<x/>' }])],
      [
        'a document.xml that is not XML',
        zip([{ name: 'word/document.xml', content: 'nu este xml <<<' }]),
      ],
    ])('%s is TEXT_NOT_EXTRACTABLE', async (_case, content) => {
      await expect(extract('docx', content)).rejects.toEqual(notExtractable);
    });
  });

  describe('PDF', () => {
    const page = (seed: number) => wrap(asciiProse(1, 6, 10 + seed));

    it('is paged: one page per page of the file, numbered from 1', async () => {
      const result = await extract('pdf', pdf([page(1), page(2), page(3)]));
      expect(result.paged).toBe(true);
      expect(result.pages.map((p) => p.number)).toEqual([1, 2, 3]);
    });

    it('reads the words of each page, in order', async () => {
      const result = await extract('pdf', pdf([page(1), page(2)]));
      const words = (text: string) => text.split(/\s+/).filter(Boolean);
      expect(words(result.pages[0]!.text)).toEqual(words(page(1).join(' ')));
      expect(words(result.pages[1]!.text)).toEqual(words(page(2).join(' ')));
    });

    it('keeps a page without text as an empty page (a scanned page)', async () => {
      const result = await extract('pdf', pdf([page(1), [], page(3)]));
      expect(result.pages).toHaveLength(3);
      expect(result.pages[1]!.text.trim()).toBe('');
    });

    it('separates lines and leaves a blank line where the file has a gap', async () => {
      const result = await extract(
        'pdf',
        pdf([['Primul rand al paginii.', 'Al doilea rand.', '', 'Paragraf nou dupa spatiu.']]),
      );
      const text = result.pages[0]!.text;
      expect(text).toMatch(/Primul rand al paginii\.\s*\n\s*Al doilea rand\./);
      expect(text).toMatch(/Al doilea rand\.\s*\n\s*\n\s*Paragraf nou dupa spatiu\./);
    });

    it('gives a valid structure, without the repeated header and the page numbers', async () => {
      const pages = Array.from({ length: 5 }, (_, i) => [
        'Universitatea Tehnica - Structuri de date',
        '',
        ...wrap(asciiProse(2, 5, 10 + i)),
        '',
        `Pagina ${i + 1}`,
      ]);
      const structure = structureText(await extract('pdf', pdf(pages)), { maxPages: 100 });
      expectValidStructure(structure);
      expect(structure.pageCount).toBe(5);
      expect(structure.text).not.toMatch(/Universitatea Tehnica/);
      expect(structure.text).not.toMatch(/Pagina \d/);
    });

    it('a PDF with only empty pages has too little text (M06)', async () => {
      const extracted = await extract('pdf', pdf([[], [], []]));
      expect(() => structureText(extracted, { maxPages: 100 })).toThrow(notExtractable);
    });

    it.each([
      ['a file cut in half', pdf([page(1), page(2)]).subarray(0, 300)],
      [
        'a header followed by rubbish',
        Buffer.from('%PDF-1.4\nnu este un pdf adevarat\n%%EOF\n', 'latin1'),
      ],
    ])('%s is TEXT_NOT_EXTRACTABLE', async (_case, content) => {
      await expect(extract('pdf', content)).rejects.toEqual(notExtractable);
    });
  });

  it('stops when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createTextExtractor().extract(
        { format: 'pdf', content: pdf([wrap(asciiProse(2))]) },
        controller.signal,
      ),
    ).rejects.toBeDefined();
  });
});
