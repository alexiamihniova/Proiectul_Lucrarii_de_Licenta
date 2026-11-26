import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readPdfPages } from '../../src/modules/documents/pdf-text.js';
import { asciiProse, pdf, wrap } from '../helpers/fixtures.js';

/**
 * The text of a PDF is read in a child process (design 3.7; OPEN_QUESTIONS, Q48): a hostile file
 * must not block or exhaust the process that serves everyone, and a timer cannot interrupt
 * synchronous code, so the process itself is what gets killed.
 */
const OPTIONS = { memoryMb: 512, maxPages: 100 };
const signal = () => new AbortController().signal;
const page = () => wrap(asciiProse(2));

/** A one-page PDF whose contents stream is `megabytes` of spaces, packed into a few hundred KB. */
function contentBomb(megabytes: number): Buffer {
  const bomb = deflateSync(Buffer.alloc(megabytes * 1024 * 1024, 0x20));
  return Buffer.concat([
    Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R >>\nendobj\n' +
        `4 0 obj\n<< /Filter /FlateDecode /Length ${bomb.length} >>\nstream\n`,
    ),
    bomb,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 5 >>\n%%EOF\n'),
  ]);
}

describe('reading a PDF in a child process', () => {
  it('reads the pages, in order, as the in-process reader would have', async () => {
    const pages = await readPdfPages(pdf([page(), page(), page()]), signal(), OPTIONS);
    expect(pages.map((p) => p.number)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.text.length > 50)).toBe(true);
  });

  it.each([
    ['a corrupt PDF', Buffer.from('%PDF-1.4\nnu este un pdf adevarat\n%%EOF\n', 'latin1')],
    ['a PDF that asks for a password', pdf([page()], { password: 'secret' })],
    ['something that is not a PDF', Buffer.from('doar text')],
  ])('refuses %s with TEXT_NOT_EXTRACTABLE', async (_name, content) => {
    await expect(readPdfPages(content, signal(), OPTIONS)).rejects.toMatchObject({
      code: 'TEXT_NOT_EXTRACTABLE',
    });
  });

  it('refuses a PDF with more pages than the limit before reading any of them', async () => {
    const error = await readPdfPages(pdf([page(), page(), page()]), signal(), {
      memoryMb: 512,
      maxPages: 2,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'FILE_TOO_LARGE',
      details: { exceeded: 'pages', limit_pages: 2, pages: 3 },
    });
  });

  it('is stopped by the signal: the child is killed and the answer is the reason of the abort', async () => {
    const bomb = contentBomb(600); // built first: making it takes the test seconds, reading it takes more
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(new Error('stopped')), 150);
    await expect(readPdfPages(bomb, controller.signal, OPTIONS)).rejects.toThrow('stopped');
    expect(Date.now() - started).toBeLessThan(1500); // reading the bomb to the end needs about 4 s
  }, 30_000);

  it('does not answer at all for a signal that is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already'));
    await expect(readPdfPages(pdf([page()]), controller.signal, OPTIONS)).rejects.toThrow(
      'already',
    );
  });

  it('does not block the process that asked: a bomb of 300 MB leaves the event loop free', async () => {
    const bomb = contentBomb(300);
    let worstStall = 0;
    let last = Date.now();
    const heartbeat = setInterval(() => {
      const now = Date.now();
      worstStall = Math.max(worstStall, now - last - 20);
      last = now;
    }, 20);
    const pages = await readPdfPages(bomb, signal(), OPTIONS);
    clearInterval(heartbeat);
    expect(pages).toHaveLength(1); // spaces only: one page, no text
    expect(worstStall).toBeLessThan(300); // read in-process, the same file stalled the loop for seconds
  }, 30_000);

  it('answers TEXT_NOT_EXTRACTABLE when the child runs out of heap, and the next file is read as usual', async () => {
    const objects = Array.from(
      { length: 400_000 },
      (_, i) => `${i + 1} 0 obj\n<< /A ${i} >>\nendobj\n`,
    );
    const hostile = Buffer.from(`%PDF-1.4\n${objects.join('')}`);
    await expect(
      readPdfPages(hostile, signal(), { memoryMb: 24, maxPages: 100 }),
    ).rejects.toMatchObject({ code: 'TEXT_NOT_EXTRACTABLE' });
    expect(await readPdfPages(pdf([page()]), signal(), OPTIONS)).toHaveLength(1);
  }, 60_000);
});
