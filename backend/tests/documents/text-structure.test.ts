import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { structureText } from '../../src/modules/documents/service.js';
import type { ExtractedText } from '../../src/modules/documents/service.js';
import { countWords, paragraph, prose, sentence } from '../helpers/fixtures.js';
import { expectPassagesOfAtLeast100Words, expectValidStructure } from '../helpers/structure.js';

/**
 * RF4 — cleaning, paragraphs, sentences and passages, as a PURE function over extracted pages.
 * Design: sections 3.2–3.6; ADR-0013. No database and no files are involved.
 */
const OPTIONS = { maxPages: 100 };
const NBSP = String.fromCharCode(0xa0);
const NUL = String.fromCharCode(0);
const SOFT_HYPHEN = String.fromCharCode(0xad);
const unpaged = (text: string): ExtractedText => ({ paged: false, pages: [{ number: 1, text }] });
const paged = (pages: string[]): ExtractedText => ({
  paged: true,
  pages: pages.map((text, index) => ({ number: index + 1, text })),
});
/** Enough plain text to pass the 200-character minimum, as its own paragraph. */
const FILLER = paragraph(4, 12, 90);
const sentencesOf = (text: string) =>
  structureText(unpaged(text), OPTIONS).sentences.map((s) => s.text);

describe('structured text (RF4, ADR-0013)', () => {
  describe('invariants', () => {
    it.each([
      ['a short text', prose(1, 4)],
      ['several paragraphs', prose(12, 5)],
      ['a long text', prose(120, 6)],
      [
        'one-sentence paragraphs',
        Array.from({ length: 60 }, (_, i) => sentence(9, i)).join('\n\n'),
      ],
      ['one huge paragraph', paragraph(150, 11)],
    ])('hold for %s', (_name, text) => {
      const structure = structureText(unpaged(text), OPTIONS);
      expectValidStructure(structure);
      expectPassagesOfAtLeast100Words(structure);
    });

    it('hold for a paged document', () => {
      const structure = structureText(
        paged(Array.from({ length: 8 }, (_, i) => prose(4, 5, 10 + i))),
        OPTIONS,
      );
      expectValidStructure(structure);
      expect(structure.pageCount).toBe(8);
    });

    it('the canonical text is the sentences of a paragraph joined by a space, paragraphs by a blank line', () => {
      const first = `${sentence(10, 1)} ${sentence(10, 2)}`;
      const second = sentence(10, 3);
      const structure = structureText(unpaged(`${first}\n\n${second}\n\n${FILLER}`), OPTIONS);
      expect(structure.text).toBe(`${first}\n\n${second}\n\n${FILLER}`);
      expect(structure.sentences.slice(0, 3).map((s) => s.paragraph)).toEqual([0, 0, 1]);
    });

    it('is deterministic: the same pages give the same structure', () => {
      const input = unpaged(prose(30, 5));
      expect(structureText(input, OPTIONS)).toEqual(structureText(input, OPTIONS));
    });

    it('does not change its input', () => {
      const input = paged([prose(3), prose(3)]);
      const copy = structuredClone(input);
      structureText(input, OPTIONS);
      expect(input).toEqual(copy);
    });
  });

  describe('cleaning (design 3.3)', () => {
    it('collapses runs of spaces, tabs and non-breaking spaces and trims the lines', () => {
      const messy = `  Prima   propoziție\tare ${NBSP} spații.   \n\n\n\n   ${FILLER}  `;
      const structure = structureText(unpaged(messy), OPTIONS);
      expect(structure.text).toBe(`Prima propoziție are spații.\n\n${FILLER}`);
    });

    it('removes NUL characters and soft hyphens; turns CRLF into line breaks', () => {
      const structure = structureText(
        unpaged(`Cu${NUL}vânt des${SOFT_HYPHEN}părțit.\r\n\r\n${FILLER}`),
        OPTIONS,
      );
      expect(structure.text).toBe(`Cuvânt despărțit.\n\n${FILLER}`);
    });

    it('joins the lines of a paragraph with a space', () => {
      const structure = structureText(
        unpaged(`Un rând\ncontinuat pe\nal treilea rând.\n\n${FILLER}`),
        OPTIONS,
      );
      expect(structure.sentences[0]!.text).toBe('Un rând continuat pe al treilea rând.');
    });

    it('joins a line that ends in a hyphen to a lower-case continuation without a space', () => {
      const structure = structureText(
        unpaged(`Lucrează într-\no echipă mare.\n\n${FILLER}`),
        OPTIONS,
      );
      expect(structure.sentences[0]!.text).toBe('Lucrează într-o echipă mare.');
    });

    it('drops paragraphs with no letter and no digit', () => {
      const structure = structureText(
        unpaged(`${FILLER}\n\n* * *\n\n-----\n\n${sentence(10, 4)}`),
        OPTIONS,
      );
      expect(structure.text).toBe(`${FILLER}\n\n${sentence(10, 4)}`);
    });

    describe('repeated headers and footers', () => {
      const body = (i: number) => prose(2, 4, 10 + i);
      const withEdges = (count: number) =>
        Array.from({ length: count }, (_, i) =>
          [
            `Universitatea Tehnică – Curs ${i + 1}`,
            '',
            body(i),
            '',
            `Pagina ${i + 1} din ${count}`,
          ].join('\n'),
        );

      it('are removed from a document with real pages', () => {
        const structure = structureText(paged(withEdges(6)), OPTIONS);
        expect(structure.text).not.toMatch(/Universitatea Tehnică/);
        expect(structure.text).not.toMatch(/Pagina \d/);
        for (let i = 0; i < 6; i += 1) expect(structure.text).toContain(body(i).split('\n\n')[0]!);
        expectValidStructure(structure);
      });

      it.each([['12'], ['– 12 –'], ['Pagina 12'], ['pag. 12'], ['12 / 40'], ['12 din 40']])(
        'a lone page number like "%s" at the edge of a page is removed',
        (footer) => {
          const pages = Array.from(
            { length: 4 },
            (_, i) => `${body(i)}\n\n${footer.replace('12', String(i + 1))}`,
          );
          const structure = structureText(paged(pages), OPTIONS);
          expect(structure.text).not.toContain(footer.replace('12', '3'));
          expect(structure.sentences.every((s) => /\p{L}/u.test(s.text))).toBe(true);
        },
      );

      it('are kept when the document has fewer than 3 pages', () => {
        const structure = structureText(paged(withEdges(2)), OPTIONS);
        expect(structure.text).toMatch(/Universitatea Tehnică/);
      });

      it('are kept in a document without real pages', () => {
        const text = withEdges(6).join('\n\n');
        expect(structureText(unpaged(text), OPTIONS).text).toMatch(/Universitatea Tehnică/);
      });

      it('a line that repeats in the middle of the pages is content, not a header', () => {
        const pages = Array.from({ length: 5 }, (_, i) =>
          [
            body(i),
            '',
            'Definiție importantă de reținut.',
            '',
            body(i + 10),
            '',
            body(i + 20),
          ].join('\n'),
        );
        const structure = structureText(paged(pages), OPTIONS);
        expect(structure.text.match(/Definiție importantă de reținut\./g)).toHaveLength(5);
      });

      it('a first line that differs on every page is kept', () => {
        const pages = Array.from(
          { length: 5 },
          (_, i) => `Capitolul ${'abcde'[i]} despre altceva\n\n${body(i)}`,
        );
        const structure = structureText(paged(pages), OPTIONS);
        expect(structure.text).toContain('Capitolul c despre altceva');
      });
    });

    it('a paragraph that continues on the next page stays one paragraph', () => {
      const pages = [
        `${FILLER}\n\nAceastă frază începe pe o pagină și`,
        `se termină pe pagina următoare.\n\n${FILLER}`,
      ];
      const structure = structureText(paged(pages), OPTIONS);
      const joined = structure.sentences.find((s) => s.text.startsWith('Această frază'))!;
      expect(joined.text).toBe(
        'Această frază începe pe o pagină și se termină pe pagina următoare.',
      );
      expect(joined.page).toBe(1);
    });

    it('a paragraph that ends with a period does not swallow the next page', () => {
      const pages = [`${FILLER}\n\nPropoziție încheiată.`, `altă idee începe aici.\n\n${FILLER}`];
      const structure = structureText(paged(pages), OPTIONS);
      const ended = structure.sentences.find((s) => s.text === 'Propoziție încheiată.')!;
      const next = structure.sentences[ended.position + 1]!;
      expect(next.text).toBe('altă idee începe aici.');
      expect(next.paragraph).toBe(ended.paragraph + 1);
      expect(next.page).toBe(2);
    });
  });

  describe('sentences (design 3.4)', () => {
    const split = (text: string) => sentencesOf(`${text}\n\n${FILLER}`).slice(0, -4);

    it('end at . ! ? and … followed by a space and a capital letter', () => {
      expect(split('Prima propoziție. A doua! A treia? A patra… A cincea.')).toEqual([
        'Prima propoziție.',
        'A doua!',
        'A treia?',
        'A patra…',
        'A cincea.',
      ]);
    });

    it('keep closing quotes and brackets with the sentence they close', () => {
      expect(split('El a spus „da.” Apoi a plecat (repede). Gata.')).toEqual([
        'El a spus „da.”',
        'Apoi a plecat (repede).',
        'Gata.',
      ]);
    });

    it('do not end at a period followed by a lower-case letter', () => {
      expect(split('Valoarea este aprox. zece unități. Atât.')).toEqual([
        'Valoarea este aprox. zece unități.',
        'Atât.',
      ]);
    });

    it.each([
      ['a title', 'Lucrarea prof. Ionescu și a dr. Popa este citată. Urmează alta.', 2],
      ['a reference', 'Vezi art. 5 alin. 2 și fig. 3 de la pag. 12. Apoi continuă.', 2],
      ['a number', 'Conform nr. 7 din tabel. Urmează restul.', 2],
      ['a comparison', 'Compară A vs. B în acest caz. Apoi decide.', 2],
    ])('do not end after the abbreviation in %s', (_case, text, expected) => {
      expect(split(text)).toHaveLength(expected);
    });

    it('do not end inside numbers and dates', () => {
      expect(split('Valoarea lui pi este 3.14 aproximativ. Data este 12.05.2026 exact.')).toEqual([
        'Valoarea lui pi este 3.14 aproximativ.',
        'Data este 12.05.2026 exact.',
      ]);
    });

    it('do not end after initials', () => {
      expect(split('Opera lui I. L. Caragiale este studiată. Urmează Eminescu.')).toEqual([
        'Opera lui I. L. Caragiale este studiată.',
        'Urmează Eminescu.',
      ]);
    });

    it('end after "etc." when a capital letter follows, but not otherwise', () => {
      expect(
        split('Avem liste, arbori etc. Fiecare are un rol. Liste, arbori etc. sunt structuri.'),
      ).toEqual([
        'Avem liste, arbori etc.',
        'Fiecare are un rol.',
        'Liste, arbori etc. sunt structuri.',
      ]);
    });

    it('a heading or list item without a final period is a sentence of its own', () => {
      const structure = structureText(
        unpaged(
          `Capitolul 1 – Introducere\n\n${FILLER}\n\n– primul element\n\n– al doilea element`,
        ),
        OPTIONS,
      );
      const texts = structure.sentences.map((s) => s.text);
      expect(texts[0]).toBe('Capitolul 1 – Introducere');
      expect(texts.slice(-2)).toEqual(['– primul element', '– al doilea element']);
    });

    it('a sentence of more than 300 words is cut at word boundaries into pieces of at most 300', () => {
      const long = sentence(700, 5);
      const structure = structureText(unpaged(`${long}\n\n${FILLER}`), OPTIONS);
      const pieces = structure.sentences.filter((s) => s.paragraph === 0);
      expect(pieces.length).toBeGreaterThanOrEqual(3);
      expect(pieces.every((s) => countWords(s.text) <= 300)).toBe(true);
      expect(pieces.map((s) => s.text).join(' ')).toBe(long);
      expectValidStructure(structure);
    });
  });

  describe('passages (design 3.5, RF4)', () => {
    it('have 100–300 words each, except possibly the last', () => {
      const structure = structureText(unpaged(prose(80, 6, 13)), OPTIONS);
      expect(structure.passages.length).toBeGreaterThan(5);
      expectValidStructure(structure);
      expectPassagesOfAtLeast100Words(structure);
    });

    it('end at a paragraph boundary once they have 100 words', () => {
      // Paragraphs of 60 words: a passage closes after the second one (120 words).
      const structure = structureText(unpaged(prose(10, 5, 12)), OPTIONS);
      for (const passage of structure.passages) {
        expect(countWords(passage.text)).toBe(120);
        expect(passage.text.split('\n\n')).toHaveLength(2);
      }
      expect(structure.passages).toHaveLength(5);
    });

    it('split a paragraph longer than 300 words between sentences', () => {
      const structure = structureText(unpaged(paragraph(70, 10)), OPTIONS); // 700 words, one paragraph
      expect(structure.passages.length).toBeGreaterThanOrEqual(3);
      for (const passage of structure.passages) {
        expect(passage.text).toMatch(/\.$/);
        expect(passage.text).not.toContain('\n');
      }
      expectValidStructure(structure);
    });

    it('a document of fewer than 100 words is one passage', () => {
      const structure = structureText(unpaged(prose(2, 3, 10)), OPTIONS); // 60 words
      expect(structure.passages).toHaveLength(1);
      expect(structure.passages[0]!.text).toBe(structure.text);
    });

    it('a short tail is merged into the previous passage when both fit in 300 words', () => {
      // 120 + 120 + 30 words: the tail joins the second passage (150 words).
      const structure = structureText(
        unpaged(`${prose(4, 5, 12)}\n\n${paragraph(3, 10, 7)}`),
        OPTIONS,
      );
      expect(structure.passages.map((p) => countWords(p.text))).toEqual([120, 150]);
    });

    it('a short tail stays on its own when merging would pass 300 words', () => {
      // One paragraph of 290 words, then 30 words.
      const structure = structureText(
        unpaged(`${paragraph(29, 10)}\n\n${paragraph(3, 10, 7)}`),
        OPTIONS,
      );
      expect(structure.passages.map((p) => countWords(p.text))).toEqual([290, 30]);
    });

    it('a passage may cross a page; its page is where it starts', () => {
      const pages = [paragraph(6, 10, 1), paragraph(6, 10, 2), paragraph(6, 10, 3)];
      const structure = structureText(paged(pages), OPTIONS);
      expect(structure.passages[0]!.page).toBe(1);
      expect(structure.sentences.at(-1)!.page).toBe(3);
      expectValidStructure(structure);
    });
  });

  describe('pages (design 3.6, Q16)', () => {
    it('a paged document keeps its real pages, including the ones without text', () => {
      const structure = structureText(paged([prose(3), '', '   \n ', prose(3, 5, 9)]), OPTIONS);
      expect(structure.pageCount).toBe(4);
      expect(new Set(structure.sentences.map((s) => s.page))).toEqual(new Set([1, 4]));
    });

    it('an unpaged document gets one page per 3000 characters of canonical text', () => {
      const structure = structureText(unpaged(prose(40, 5, 12)), OPTIONS);
      expect(structure.pageCount).toBe(Math.ceil(structure.text.length / 3000));
      expect(structure.pageCount).toBeGreaterThan(3);
      for (const s of structure.sentences)
        expect(s.page).toBe(Math.floor(s.startOffset / 3000) + 1);
    });

    it('a short unpaged document has one page', () => {
      expect(structureText(unpaged(prose(1, 4)), OPTIONS).pageCount).toBe(1);
    });

    it('more pages than the limit is FILE_TOO_LARGE with the limit in the details (M05)', () => {
      const attempt = () =>
        structureText(paged(Array.from({ length: 4 }, () => prose(2))), { maxPages: 3 });
      expect(attempt).toThrow(AppError);
      try {
        attempt();
      } catch (error) {
        expect(error).toMatchObject({ code: 'FILE_TOO_LARGE' });
        expect((error as AppError).details).toMatchObject({ exceeded: 'pages', limit_pages: 3 });
      }
    });

    it('exactly the limit is accepted', () => {
      expect(
        structureText(paged(Array.from({ length: 3 }, () => prose(2))), { maxPages: 3 }).pageCount,
      ).toBe(3);
    });

    it('the limit also applies to the computed pages of an unpaged document', () => {
      expect(() => structureText(unpaged(prose(40, 5, 12)), { maxPages: 2 })).toThrow(
        expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
      );
    });
  });

  describe('too little text (M06)', () => {
    it.each([
      ['no pages', paged([])],
      ['empty pages, like a scanned document', paged(['', '  ', '\n\n'])],
      ['199 characters', unpaged('a'.repeat(199))],
      ['only page numbers', paged(['1', '2', '3', '4'])],
    ])('%s is TEXT_NOT_EXTRACTABLE', (_case, input) => {
      expect(() => structureText(input, OPTIONS)).toThrow(
        expect.objectContaining({ code: 'TEXT_NOT_EXTRACTABLE' }),
      );
    });

    it('exactly 200 characters is accepted', () => {
      const text = `${'cuvânt '.repeat(28)}abcd`.slice(0, 200);
      expect(text).toHaveLength(200);
      expect(structureText(unpaged(text), OPTIONS).text).toHaveLength(200);
    });
  });
});
