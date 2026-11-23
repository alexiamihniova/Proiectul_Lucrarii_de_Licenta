import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

/**
 * Files built in memory for the documents tests: no binary fixture is committed, and each test
 * says in its own lines what the file contains.
 */

const WORDS = [
  'algoritmul', 'sortează', 'elementele', 'unei', 'liste', 'comparând', 'valorile', 'vecine',
  'memoria', 'calculatorului', 'păstrează', 'datele', 'programului', 'în', 'timpul', 'execuției',
  'baza', 'de', 'date', 'relațională', 'folosește', 'tabele', 'legate', 'prin', 'chei',
  'funcția', 'primește', 'parametri', 'și', 'întoarce', 'un', 'rezultat', 'determinist',
]; // prettier-ignore

/** One sentence of exactly `words` words, deterministic for a given `seed`, ending in a period. */
export function sentence(words: number, seed = 0): string {
  const picked = Array.from({ length: words }, (_, i) => WORDS[(seed * 7 + i * 3) % WORDS.length]!);
  const text = picked.join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** A paragraph of `sentences` sentences, each of `wordsPerSentence` words. */
export function paragraph(sentences: number, wordsPerSentence = 12, seed = 0): string {
  return Array.from({ length: sentences }, (_, i) => sentence(wordsPerSentence, seed + i)).join(
    ' ',
  );
}

/** Plain text with `paragraphs` paragraphs separated by blank lines. */
export function prose(paragraphs: number, sentencesEach = 5, wordsPerSentence = 12): string {
  return Array.from({ length: paragraphs }, (_, i) =>
    paragraph(sentencesEach, wordsPerSentence, i * 11),
  ).join('\n\n');
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}

export function txt(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

// --- ZIP (stored entries) and DOCX ----------------------------------------------------------

export function zip(files: { name: string; content: string | Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);
    offset += local.length + name.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}

const xml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** A minimal, valid .docx whose body is the given paragraphs. */
export function docx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`)
    .join('');
  return zip([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}<w:sectPr/></w:body></w:document>`,
    },
  ]);
}

// --- PDF ------------------------------------------------------------------------------------

const pdfString = (text: string) =>
  text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');

/** RC4, written out because OpenSSL 3 no longer offers it; only for the encrypted fixture. */
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let n = 0; n < data.length; n += 1) {
    a = (a + 1) & 255;
    b = (b + s[a]!) & 255;
    [s[a], s[b]] = [s[b]!, s[a]!];
    out[n] = data[n]! ^ s[(s[a]! + s[b]!) & 255]!;
  }
  return out;
}

const PDF_PADDING = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);
const md5 = (...parts: Buffer[]) => createHash('md5').update(Buffer.concat(parts)).digest();

/** The /Encrypt entries of a password-protected PDF (standard handler, V1 R2, 40-bit RC4). */
function pdfEncryption(userPassword: string, id: Buffer) {
  const padded = (password: string) =>
    Buffer.concat([Buffer.from(password, 'latin1'), PDF_PADDING]).subarray(0, 32);
  const owner = rc4(md5(padded('owner-password')).subarray(0, 5), padded(userPassword));
  const permissions = Buffer.from([0xfc, 0xff, 0xff, 0xff]); // -4
  const key = md5(padded(userPassword), owner, permissions, id).subarray(0, 5);
  const user = rc4(key, PDF_PADDING);
  return `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`;
}

/**
 * A minimal, valid PDF. Each page is a list of lines (ASCII only: the built-in Helvetica font
 * has no Romanian diacritics). An empty string leaves a blank line, i.e. starts a paragraph.
 * A page with no lines has no text at all, like a scanned page. With `password`, the file asks
 * for it before it can be opened (its streams are not really encrypted: enough to be refused).
 */
export function pdf(pages: string[][], options: { password?: string } = {}): Buffer {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body);
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);

  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  for (const [index, lines] of pages.entries()) {
    const contentNumber = pageObjectNumbers[index]! + 1;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    );
    let y = 800;
    const operations: string[] = [];
    for (const line of lines) {
      if (line !== '') operations.push(`BT /F1 11 Tf 50 ${y} Td (${pdfString(line)}) Tj ET`);
      y -= 14;
    }
    const stream = operations.join('\n');
    add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }

  const id = Buffer.from('0123456789abcdef', 'latin1');
  if (options.password !== undefined) add(pdfEncryption(options.password, id));
  const encryptNumber = objects.length;

  let output = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(output, 'latin1'));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, 'latin1');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  const trailer =
    options.password === undefined
      ? `<< /Size ${objects.length + 1} /Root 1 0 R >>`
      : `<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt ${encryptNumber} 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] >>`;
  output += `trailer\n${trailer}\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
}

/** Breaks ASCII text into lines of at most `width` characters, for `pdf()`. */
export function wrap(text: string, width = 80): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** `prose()` without diacritics, for PDF fixtures. */
export function asciiProse(paragraphs: number, sentencesEach = 5, wordsPerSentence = 12): string {
  return prose(paragraphs, sentencesEach, wordsPerSentence)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replaceAll('ș', 's')
    .replaceAll('ț', 't');
}

// --- multipart ------------------------------------------------------------------------------

/** A `multipart/form-data` body with one file part, for `app.inject`. */
export function multipart(
  file: { fileName: string; content: Buffer; contentType?: string },
  fieldName = 'file',
): { headers: Record<string, string>; payload: Buffer } {
  const boundary = '----recap-test-boundary-7d3f9a';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${file.fileName.replaceAll('"', '%22')}"\r\n` +
      `Content-Type: ${file.contentType ?? 'application/octet-stream'}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, file.content, tail]),
  };
}
