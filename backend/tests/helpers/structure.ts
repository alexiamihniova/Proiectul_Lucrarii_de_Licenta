import { expect } from 'vitest';
import type { StructuredText } from '../../src/modules/documents/service.js';
import { countWords } from './fixtures.js';

/**
 * The invariants of structured text (docs/design/documents.md, 3.2 and 3.5). Every test that
 * produces a structure — from the pure function or from a processed document — runs them.
 */
export function expectValidStructure(structure: StructuredText): void {
  const { text, sentences, passages, pageCount } = structure;
  expect(sentences.length).toBeGreaterThan(0);
  expect(passages.length).toBeGreaterThan(0);
  expect(pageCount).toBeGreaterThanOrEqual(1);

  // 6. No text starts or ends with a space or holds two spaces in a row.
  expect(text).not.toMatch(/^\s|\s$| {2}|\t|\r/);

  // 1, 2, 4. Sentences: exact slices, in order, separated by " " or "\n\n", no gaps.
  let cursor = 0;
  for (const [index, sentence] of sentences.entries()) {
    expect(sentence.position, `sentence ${index} position`).toBe(index);
    expect(text.slice(sentence.startOffset, sentence.endOffset)).toBe(sentence.text);
    expect(sentence.text).toBe(sentence.text.trim());
    expect(sentence.text.length).toBeGreaterThan(0);
    expect(sentence.text).not.toContain('\n');
    expect(sentence.page).toBeGreaterThanOrEqual(1);
    expect(sentence.page).toBeLessThanOrEqual(pageCount);

    const previous = sentences[index - 1];
    if (!previous) {
      expect(sentence.startOffset).toBe(0);
      expect(sentence.paragraph).toBe(0);
    } else {
      const gap = text.slice(cursor, sentence.startOffset);
      if (sentence.paragraph === previous.paragraph) expect(gap).toBe(' ');
      else {
        expect(gap).toBe('\n\n');
        expect(sentence.paragraph).toBe(previous.paragraph + 1);
      }
      expect(sentence.page).toBeGreaterThanOrEqual(previous.page);
    }
    cursor = sentence.endOffset;
  }
  expect(cursor).toBe(text.length);

  // 3, 4, 5. Passages: runs of whole sentences that cover every sentence exactly once.
  let nextSentence = 0;
  for (const [index, passage] of passages.entries()) {
    expect(passage.position, `passage ${index} position`).toBe(index);
    expect(passage.firstSentence).toBe(nextSentence);
    expect(passage.lastSentence).toBeGreaterThanOrEqual(passage.firstSentence);
    const first = sentences[passage.firstSentence]!;
    const last = sentences[passage.lastSentence]!;
    expect(passage.startOffset).toBe(first.startOffset);
    expect(passage.endOffset).toBe(last.endOffset);
    expect(text.slice(passage.startOffset, passage.endOffset)).toBe(passage.text);
    expect(passage.page).toBe(first.page);
    for (let i = passage.firstSentence; i <= passage.lastSentence; i += 1) {
      expect(sentences[i]!.passagePosition).toBe(index);
    }
    // RF4: never more than 300 words.
    expect(countWords(passage.text), `passage ${index} words`).toBeLessThanOrEqual(300);
    nextSentence = passage.lastSentence + 1;
  }
  expect(nextSentence).toBe(sentences.length);
}

/** RF4 lower bound: every passage but the last has at least 100 words. */
export function expectPassagesOfAtLeast100Words(structure: StructuredText): void {
  for (const passage of structure.passages.slice(0, -1)) {
    expect(countWords(passage.text), `passage ${passage.position}`).toBeGreaterThanOrEqual(100);
  }
}
