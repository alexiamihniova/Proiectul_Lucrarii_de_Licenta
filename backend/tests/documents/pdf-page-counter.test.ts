import { describe, expect, it } from 'vitest';
import { createPdfPageCounter } from '../../src/modules/documents/service.js';
import { asciiProse, pdf, wrap } from '../helpers/fixtures.js';

/**
 * The real page counter (design 2.5, Q48): a separate process, with a timeout and a memory limit.
 * The measurements that set its default values are in docs/OPEN_QUESTIONS.md, Q48.
 */
const counter = createPdfPageCounter();
const LIMITS = { timeoutMs: 10_000, maxMemoryMb: 256 };
const page = () => wrap(asciiProse(2));

describe('the real PDF page counter (Q48)', () => {
  it('counts the pages of a PDF, with or without text on them', async () => {
    expect(await counter.count(pdf([page(), page(), []]), LIMITS)).toEqual({
      kind: 'pages',
      pages: 3,
    });
  });

  it('does not change the buffer it is given', async () => {
    const content = pdf([page()]);
    const copy = Buffer.from(content);
    await counter.count(content, LIMITS);
    expect(content.equals(copy)).toBe(true);
  });

  it.each([
    ['a corrupt PDF', Buffer.from('%PDF-1.4\nnu este un pdf adevarat\n%%EOF\n', 'latin1')],
    ['a PDF cut in half', pdf([page(), page()]).subarray(0, 300)],
    ['a PDF that asks for a password', pdf([page()], { password: 'secret' })],
    ['something that is not a PDF at all', Buffer.from('doar text')],
  ])('answers "unreadable" for %s, not an error', async (_name, content) => {
    expect(await counter.count(content, LIMITS)).toEqual({ kind: 'unreadable' });
  });

  it('answers "timeout" when the time is up, and stops the process', async () => {
    const outcome = await counter.count(pdf([page()]), { timeoutMs: 1, maxMemoryMb: 256 });
    expect(outcome).toEqual({ kind: 'timeout' });
  });

  it('answers "memory" when the process needs more than its limit, and the application survives', async () => {
    // Several hundred thousand objects without a table that lists them: pdf.js has to rebuild
    // it by reading everything, and a heap of 24 MB is not enough for that.
    const objects = Array.from(
      { length: 400_000 },
      (_, i) => `${i + 1} 0 obj\n<< /A ${i} >>\nendobj\n`,
    );
    const hostile = Buffer.from(`%PDF-1.4\n${objects.join('')}`);
    expect(await counter.count(hostile, { timeoutMs: 20_000, maxMemoryMb: 24 })).toEqual({
      kind: 'memory',
    });
    // The test process is still here, and the next file is counted as usual.
    expect(await counter.count(pdf([page()]), LIMITS)).toEqual({ kind: 'pages', pages: 1 });
  }, 60_000);

  it('does not run more than a few counts at once, and answers every one', async () => {
    const content = pdf([page()]);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => counter.count(content, LIMITS)),
    );
    expect(outcomes).toEqual(Array.from({ length: 10 }, () => ({ kind: 'pages', pages: 1 })));
  }, 60_000);
});
