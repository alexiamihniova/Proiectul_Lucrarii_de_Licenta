import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_XML_BYTES,
  hasDocxBody,
  readDocxText,
} from '../../src/modules/documents/docx.js';
import { pageText } from '../../src/modules/documents/pdf-text.js';
import type { TextFragment } from '../../src/modules/documents/pdf-text.js';
import { docx, sentence, zip } from '../helpers/fixtures.js';

/**
 * Parts of the extractors that the specification reaches only through whole files: the real
 * way Word packs a .docx (deflated entries), the limit on unpacking, and the layout of a page.
 */

/** A one-entry ZIP archive whose entry is DEFLATED, as Word writes it. */
function deflatedZip(entries: { name: string; content: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, content } of entries) {
    const nameBytes = Buffer.from(name);
    const packed = deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    chunks.push(local, nameBytes, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}

const WORD = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const body = (inner: string) =>
  `<?xml version="1.0"?><w:document ${WORD}><w:body>${inner}</w:body></w:document>`;
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe('DOCX reading', () => {
  it('reads a deflated body, as Word writes it', () => {
    const archive = deflatedZip([
      { name: '[Content_Types].xml', content: Buffer.from('<Types/>') },
      {
        name: 'word/document.xml',
        content: Buffer.from(body(para('Primul.') + para('Al doilea.'))),
      },
    ]);
    expect(readDocxText(archive)).toBe('Primul.\n\nAl doilea.');
  });

  it('reads the paragraphs of a table cell in order, and skips what is not body text', () => {
    const xml = body(
      para('Înainte') +
        '<w:tbl><w:tr><w:tc>' +
        para('Celula 1') +
        '</w:tc><w:tc>' +
        para('Celula 2') +
        '</w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:delText>text șters</w:delText></w:r></w:p>' +
        para('După'),
    );
    const text = readDocxText(
      deflatedZip([{ name: 'word/document.xml', content: Buffer.from(xml) }]),
    );
    expect(text).toBe('Înainte\n\nCelula 1\n\nCelula 2\n\nDupă');
  });

  it('reads tabs and line breaks inside a paragraph, and joins the runs of one paragraph', () => {
    const xml = body(
      '<w:p><w:r><w:t>Unu</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>doi</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>trei</w:t></w:r></w:p>',
    );
    const text = readDocxText(
      deflatedZip([{ name: 'word/document.xml', content: Buffer.from(xml) }]),
    );
    expect(text).toBe('Unu doi\ntrei');
  });

  it('decodes the XML entities, numeric ones too', () => {
    const text = readDocxText(
      docx([]).length
        ? deflatedZip([
            {
              name: 'word/document.xml',
              content: Buffer.from(body(para('a &lt; b &amp; c &#x21; &#33;'))),
            },
          ])
        : Buffer.alloc(0),
    );
    expect(text).toBe('a < b & c ! !');
  });

  it('does not unpack more than the limit: a bomb is refused, not inflated into memory', () => {
    const bomb = deflatedZip([
      { name: 'word/document.xml', content: Buffer.alloc(MAX_DOCUMENT_XML_BYTES + 1, 0x61) },
    ]);
    expect(bomb.length).toBeLessThan(1024 * 1024); // 100 MB of "a" packs into a few hundred KB
    expect(() => readDocxText(bomb)).toThrow(
      expect.objectContaining({ code: 'TEXT_NOT_EXTRACTABLE' }),
    );
  });

  it.each([
    ['not an archive', Buffer.from('nu este o arhivă ZIP, dar are cam atât de multe octeți')],
    ['an archive without the body', zip([{ name: 'word/styles.xml', content: '<x/>' }])],
    [
      'a body that is not a document',
      deflatedZip([{ name: 'word/document.xml', content: Buffer.from('<html/>') }]),
    ],
    [
      'a central directory that points outside the file',
      (() => {
        const a = Buffer.from(docx(['x']));
        a.writeUInt32LE(0x7fffff00, a.length - 6);
        return a;
      })(),
    ],
  ])('refuses %s with TEXT_NOT_EXTRACTABLE', (_name, archive) => {
    expect(() => readDocxText(archive)).toThrow(
      expect.objectContaining({ code: 'TEXT_NOT_EXTRACTABLE' }),
    );
  });

  it('hasDocxBody tells a .docx from another archive without unpacking it', () => {
    expect(hasDocxBody(docx(['Un paragraf.']))).toBe(true);
    expect(hasDocxBody(zip([{ name: 'ppt/presentation.xml', content: '<p/>' }]))).toBe(false);
    expect(hasDocxBody(Buffer.from('PK nu chiar'))).toBe(false);
  });

  it('keeps the sentence text intact through a deflated body', () => {
    const wanted = sentence(30, 4);
    const archive = deflatedZip([
      { name: 'word/document.xml', content: Buffer.from(body(para(wanted))) },
    ]);
    expect(readDocxText(archive)).toBe(wanted);
  });
});

describe('PDF page layout', () => {
  const at = (text: string, x: number, y: number, width = text.length * 5): TextFragment => ({
    text,
    x,
    y,
    width,
    height: 10,
  });

  it('puts fragments on one baseline on one line, with a space where there is a gap', () => {
    expect(pageText([at('Primul', 50, 700), at('cuvânt', 90, 700), at('lipit', 125, 700)])).toBe(
      'Primul cuvânt lipit',
    );
  });

  it('reads the lines from top to bottom whatever the order of the fragments', () => {
    expect(pageText([at('trei', 50, 670), at('unu', 50, 700), at('doi', 50, 685)])).toBe(
      'unu\ndoi\ntrei',
    );
  });

  it('leaves a blank line where the vertical gap is larger than the usual line spacing', () => {
    const text = pageText([
      at('a1', 50, 700), at('a2', 50, 686), at('a3', 50, 672),
      at('b1', 50, 640), at('b2', 50, 626),
    ]); // prettier-ignore
    expect(text).toBe('a1\na2\na3\n\nb1\nb2');
  });

  it('reads two columns one after the other, left first', () => {
    const left = (n: number) => at(`stânga ${n}`, 50, 700 - n * 14, 100);
    const right = (n: number) => at(`dreapta ${n}`, 320, 700 - n * 14, 100);
    const fragments = [1, 2, 3, 4].flatMap((n) => [left(n), right(n)]);
    expect(pageText(fragments)).toBe(
      'stânga 1\nstânga 2\nstânga 3\nstânga 4\n\ndreapta 1\ndreapta 2\ndreapta 3\ndreapta 4',
    );
  });

  it('reads the page as one flow when a title crosses the gutter', () => {
    const title = at('Un titlu care trece peste ambele coloane', 50, 740, 470);
    const fragments = [
      title,
      ...[1, 2, 3, 4].flatMap((n) => [
        at(`s${n}`, 50, 700 - n * 14, 100),
        at(`d${n}`, 320, 700 - n * 14, 100),
      ]),
    ];
    const text = pageText(fragments);
    expect(text.split('\n')[0]).toBe('Un titlu care trece peste ambele coloane');
    // Not split into columns: the two fragments of a row stay together, as one flow.
    expect(text).toContain('s1 d1');
  });

  it('gives nothing for a page without text', () => {
    expect(pageText([])).toBe('');
    expect(pageText([at(' ', 50, 700)])).toBe('');
  });
});
