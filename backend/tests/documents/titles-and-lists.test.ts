import { describe, expect, it } from 'vitest';
import { structureText } from '../../src/modules/documents/service.js';
import type { ExtractedText } from '../../src/modules/documents/service.js';
import { paragraph } from '../helpers/fixtures.js';
import { expectValidStructure } from '../helpers/structure.js';

/**
 * A short line without a final mark (a title, a list item) is a unit of its own, not glued to the
 * text around it (design 3.3, rule 3). Found on real reports: titles inside the same block of lines
 * as the text that follows them made "sentences" of several hundred characters, and the passages
 * shown for a concept came out too long.
 */
const OPTIONS = { maxPages: 100 };
const unpaged = (text: string): ExtractedText => ({ paged: false, pages: [{ number: 1, text }] });
const sentencesOf = (text: string) =>
  structureText(unpaged(text), OPTIONS).sentences.map((s) => s.text);

/** Lines as a PDF wraps them: about 75 characters, the way real text arrives. */
const BODY = [
  'Un router leagă mai multe rețele între ele și hotărăște pe ce cale trece fiecare pachet primit.',
  'Tabela de rutare spune ce rețele sunt cunoscute și prin ce interfață se ajunge la fiecare dintre ele.',
  'Când nu există o rută potrivită, pachetul este aruncat, iar expeditorul poate primi un mesaj de eroare.',
  'Administratorul poate adăuga rute statice sau poate lăsa un protocol să le învețe singur.',
].join('\n');

describe('titles and list items (design 3.3)', () => {
  it('a title in the same block as the text after it is a sentence of its own', () => {
    const sentences = sentencesOf(`Capitolul 2 – Rutarea\n${BODY}`);
    expect(sentences[0]).toBe('Capitolul 2 – Rutarea');
    expect(sentences[1]).toMatch(/^Un router leagă/);
    expect(sentences.every((s) => s.length < 220)).toBe(true);
  });

  it('a title in the middle of the text splits it into the text before, the title and the text after', () => {
    const text = `${BODY}\n2.1 Rute statice\n${BODY}`;
    const structure = structureText(unpaged(text), OPTIONS);
    const sentences = structure.sentences.map((s) => s.text);
    expect(sentences).toContain('2.1 Rute statice');
    const title = structure.sentences.find((s) => s.text === '2.1 Rute statice')!;
    // The title is its own paragraph: the text before and after are not in it.
    expect(structure.sentences[title.position - 1]!.paragraph).toBeLessThan(title.paragraph);
    expect(structure.sentences[title.position + 1]!.paragraph).toBeGreaterThan(title.paragraph);
    expectValidStructure(structure);
  });

  it.each([
    ['dashes', ['- primul element', '- al doilea element', '- al treilea element']],
    ['bullets', ['• primul element', '• al doilea element', '• al treilea element']],
    ['numbers', ['1. primul element', '2. al doilea element', '3) al treilea element']],
    ['letters', ['a) primul element', 'b) al doilea element', 'c) al treilea element']],
  ])(
    'each item of a list with %s is a sentence of its own, with or without a final mark',
    (_name, items) => {
      const sentences = sentencesOf(`Lista conține:\n${items.join('\n')}\n${BODY}`);
      for (const item of items) expect(sentences).toContain(item);
    },
  );

  it('the continuation of a list item, on the next line and in lower case, stays with its item', () => {
    const sentences = sentencesOf(
      `${BODY}\n- primul element care se întinde\npe două rânduri\n- al doilea element\n${BODY}`,
    );
    expect(sentences).toContain('- primul element care se întinde pe două rânduri');
    expect(sentences).toContain('- al doilea element');
  });

  it('a line wrapped by the page is NOT a title, even when a capital letter starts the next one', () => {
    // The first line runs to the margin like the rest, and the second starts with a proper noun.
    const wrapped = [
      'Lucrarea a fost realizată în cadrul laboratorului de rețele al Universității Tehnice din',
      'Moldova, sub îndrumarea cadrelor didactice ale facultății, pe parcursul semestrului de toamnă.',
      'Rezultatele au fost prezentate la sfârșitul semestrului, într-o sesiune deschisă tuturor studenților.',
    ].join('\n');
    const sentences = sentencesOf(wrapped);
    expect(sentences[0]).toBe(
      'Lucrarea a fost realizată în cadrul laboratorului de rețele al Universității Tehnice din Moldova, sub îndrumarea cadrelor didactice ale facultății, pe parcursul semestrului de toamnă.',
    );
  });

  it('short wrapped lines, as in two columns, are not split at a capital letter either', () => {
    // Every line is short, so none is "short" next to the long lines of its page.
    const columns = [
      'Algoritmul sortează elementele unei',
      'liste comparând valorile vecine și',
      'schimbându-le atunci când ordinea',
      'este greșită, apoi trece mai departe',
      'Memoria calculatorului păstrează',
      'datele programului în timpul',
      'execuției, iar baza de date folosește',
      'tabele legate prin chei.',
    ].join('\n');
    expect(sentencesOf(columns)).toEqual([
      'Algoritmul sortează elementele unei liste comparând valorile vecine și schimbându-le atunci când ordinea este greșită, apoi trece mai departe Memoria calculatorului păstrează datele programului în timpul execuției, iar baza de date folosește tabele legate prin chei.',
    ]);
  });

  it('a short line followed by a line in lower case is a wrapped line, not a title', () => {
    const sentences = sentencesOf(`${BODY}\nUn rând scurt\ncontinuat pe al doilea rând.`);
    expect(sentences).toContain('Un rând scurt continuat pe al doilea rând.');
  });

  it('a short line that ends with a mark is not a title: it is a sentence, or a clause', () => {
    const sentences = sentencesOf(`${BODY}\nAm terminat aici.\nUrmează altceva.`);
    expect(sentences).toContain('Am terminat aici.');
    expect(sentences).toContain('Urmează altceva.');
  });

  it('does not change a document whose lines are all paragraphs separated by blank lines', () => {
    const text = [paragraph(3, 10, 1), paragraph(3, 10, 2), paragraph(3, 10, 3)].join('\n\n');
    expect(structureText(unpaged(text), OPTIONS).text).toBe(text);
  });

  it('a title splits a PDF page as well, and the sentence after it keeps the page it starts on', () => {
    const pages: ExtractedText = {
      paged: true,
      pages: [
        { number: 1, text: `${BODY}\n\n3 Concluzii\n${BODY}` },
        { number: 2, text: BODY },
        { number: 3, text: BODY },
      ],
    };
    const structure = structureText(pages, OPTIONS);
    const title = structure.sentences.find((s) => s.text === '3 Concluzii')!;
    expect(title.page).toBe(1);
    expect(structure.sentences[title.position + 1]!.text).toMatch(/^Un router leagă/);
    expectValidStructure(structure);
  });
});
