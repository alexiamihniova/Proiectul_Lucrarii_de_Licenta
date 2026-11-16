import { describe, expect, it } from 'vitest';
import {
  EvaluateAnswerOutput,
  ExtractConceptsOutput,
  FakeLLMClient,
  GenerateMaterialsOutput,
  GeneratedMaterial,
  LLMError,
  LLM_MAX_ATTEMPTS,
  LLM_TIMEOUTS_MS,
  createLlmClient,
} from '../src/modules/llm/service.js';
import type { LLMClient } from '../src/modules/llm/service.js';
import { MATERIAL_TYPES } from '../src/core/domain.js';
import { testConfig } from './helpers/env.js';

const passages = [
  {
    id: 11,
    page: 1,
    text: 'Cheia primară identifică în mod unic fiecare rând dintr-un tabel relațional.',
  },
  {
    id: 12,
    page: 2,
    text: 'Operația JOIN combină rânduri din două tabele pe baza unei condiții comune.',
  },
];
const concept = { name: 'Cheie primară', definition: 'Identifică unic un rând.' };

describe('LLMClient — fake implementation', () => {
  it('is what the factory returns for LLM_PROVIDER=fake, and satisfies the interface', () => {
    const client: LLMClient = createLlmClient(testConfig());
    expect(client).toBeInstanceOf(FakeLLMClient);
    expect(client.model).toBe('fake-model');
  });

  it('the factory refuses providers that are not implemented yet', () => {
    const config = testConfig({ LLM_PROVIDER: 'other', LLM_API_KEY: 'k', LLM_MODEL: 'm' });
    expect(() => createLlmClient(config)).toThrow(/Segment 3/);
  });

  it('extractConcepts returns schema-valid concepts that cite real passage ids', async () => {
    const fake = new FakeLLMClient();
    const { output, usage } = await fake.extractConcepts({ passages });
    expect(ExtractConceptsOutput.safeParse(output).success).toBe(true);
    expect(output.concepts).toHaveLength(2);
    const ids = new Set(passages.map((p) => p.id));
    for (const item of output.concepts) {
      expect(item.passage_ids.every((id) => ids.has(id))).toBe(true);
    }
    expect(usage.input_tokens).toBeGreaterThan(0);
    expect(usage.output_tokens).toBeGreaterThan(0);
  });

  it.each(MATERIAL_TYPES)(
    'generateMaterials(%s) returns valid materials whose quote is in the passage',
    async (type) => {
      const fake = new FakeLLMClient();
      const { output } = await fake.generateMaterials({
        concept,
        passages,
        type,
        count: 3,
        difficulty: 'medium',
      });
      expect(GenerateMaterialsOutput.safeParse(output).success).toBe(true);
      expect(output.materials).toHaveLength(3);
      for (const material of output.materials) {
        expect(material.type).toBe(type);
        const passage = passages.find((p) => p.id === material.passage_id);
        expect(passage, 'passage id must exist').toBeDefined();
        expect(passage!.text).toContain(material.quote);
        if (type === 'multiple_choice') {
          expect(material.options).toHaveLength(4);
          expect(material.options).toContain(material.answer);
        } else {
          expect(material.options).toBeNull();
        }
      }
    },
  );

  it('evaluateAnswer returns complete, partial or incorrect', async () => {
    const fake = new FakeLLMClient();
    const base = {
      question: 'Ce este cheia primară?',
      reference_answer: 'Identifică unic un rând',
      passage_text: passages[0]!.text,
    };
    const verdict = async (student_answer: string) =>
      (await fake.evaluateAnswer({ ...base, student_answer })).output.verdict;
    expect(await verdict('identifică  unic un RÂND')).toBe('complete');
    expect(await verdict('ceva despre unic')).toBe('partial');
    expect(await verdict('nu știu')).toBe('incorrect');
    expect(await verdict('')).toBe('incorrect');
    const { output } = await fake.evaluateAnswer({ ...base, student_answer: 'x' });
    expect(EvaluateAnswerOutput.safeParse(output).success).toBe(true);
  });

  it('is deterministic and records every call', async () => {
    const fake = new FakeLLMClient();
    const first = await fake.extractConcepts({ passages });
    const second = await fake.extractConcepts({ passages });
    expect(second).toEqual(first);
    expect(fake.calls.map((call) => call.operation)).toEqual([
      'extract_concepts',
      'extract_concepts',
    ]);
    fake.reset();
    expect(fake.calls).toEqual([]);
  });

  it.each(['timeout', 'invalid_response', 'rate_limited', 'unavailable'] as const)(
    'throws a scripted %s as LLMError, once, then recovers (retry scenario)',
    async (kind) => {
      const fake = new FakeLLMClient().enqueue('generate_materials', { error: kind });
      const input = {
        concept,
        passages,
        type: 'flashcard' as const,
        count: 1,
        difficulty: 'easy' as const,
      };
      const failure = await fake.generateMaterials(input).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(LLMError);
      expect(failure).toMatchObject({ kind, operation: 'generate_materials' });
      await expect(fake.generateMaterials(input)).resolves.toBeDefined();
      expect(fake.calls).toHaveLength(2);
    },
  );

  it('scripted failures affect only their own operation', async () => {
    const fake = new FakeLLMClient().enqueue('evaluate_answer', { error: 'timeout' });
    await expect(fake.extractConcepts({ passages })).resolves.toBeDefined();
  });

  it('turns output that does not match the format into invalid_response (rule R1)', async () => {
    const fake = new FakeLLMClient().enqueue('extract_concepts', {
      output: { concepts: [{ name: '' }] },
    });
    await expect(fake.extractConcepts({ passages })).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });

  it('can return scripted output that is well-formed but has an unverifiable source (rules R3, R4)', async () => {
    const fake = new FakeLLMClient().enqueue('generate_materials', {
      output: {
        materials: [
          {
            type: 'flashcard',
            statement: 'Q?',
            answer: 'A',
            explanation: null,
            options: null,
            passage_id: 999,
            quote: 'text inexistent',
          },
        ],
      },
    });
    const { output } = await fake.generateMaterials({
      concept,
      passages,
      type: 'flashcard',
      count: 1,
      difficulty: 'easy',
    });
    expect(output.materials[0]!.passage_id).toBe(999);
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new FakeLLMClient().extractConcepts({ passages }, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(LLMError);
  });
});

describe('LLM operation schemas (SRS Tabelul 3.3)', () => {
  const material = {
    type: 'multiple_choice',
    statement: 'Q?',
    answer: 'a',
    explanation: null,
    options: ['a', 'b', 'c', 'd'],
    passage_id: 1,
    quote: 'citat',
  };
  const valid = (value: unknown) => GeneratedMaterial.safeParse(value).success;

  it('a multiple-choice question has exactly 4 options, one of which is the answer', () => {
    expect(valid(material)).toBe(true);
    expect(valid({ ...material, options: ['a', 'b', 'c'] })).toBe(false);
    expect(valid({ ...material, options: ['a', 'b', 'c', 'd', 'e'] })).toBe(false);
    expect(valid({ ...material, answer: 'z' })).toBe(false);
    expect(valid({ ...material, options: null })).toBe(false);
  });

  it('other types have no options; only a summary may have no answer', () => {
    expect(valid({ ...material, type: 'flashcard' })).toBe(false);
    expect(valid({ ...material, type: 'flashcard', options: null })).toBe(true);
    expect(valid({ ...material, type: 'open', options: null, answer: null })).toBe(false);
    expect(valid({ ...material, type: 'summary', options: null, answer: null })).toBe(true);
    expect(valid({ ...material, type: 'true_false', options: null, answer: 'maybe' })).toBe(false);
    expect(valid({ ...material, type: 'true_false', options: null, answer: 'false' })).toBe(true);
  });

  it('every material must carry a passage id and a quote', () => {
    expect(valid({ ...material, quote: '' })).toBe(false);
    expect(valid({ ...material, passage_id: undefined })).toBe(false);
  });

  it('concepts: name 1–80, definition ≤ 300, at least one passage, at most 100 concepts', () => {
    const item = { name: 'x', definition: '', passage_ids: [1] };
    const ok = (concepts: unknown[]) => ExtractConceptsOutput.safeParse({ concepts }).success;
    expect(ok([item])).toBe(true);
    expect(ok([{ ...item, name: 'x'.repeat(81) }])).toBe(false);
    expect(ok([{ ...item, definition: 'x'.repeat(301) }])).toBe(false);
    expect(ok([{ ...item, passage_ids: [] }])).toBe(false);
    expect(ok(Array.from({ length: 101 }, () => item))).toBe(false);
  });

  it('evaluation: three verdicts, explanation ≤ 200 characters', () => {
    expect(EvaluateAnswerOutput.safeParse({ verdict: 'partial', explanation: 'ok' }).success).toBe(
      true,
    );
    expect(EvaluateAnswerOutput.safeParse({ verdict: 'correct', explanation: 'ok' }).success).toBe(
      false,
    );
    expect(
      EvaluateAnswerOutput.safeParse({ verdict: 'partial', explanation: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('timeouts and retry limit match the specification', () => {
    expect(LLM_TIMEOUTS_MS).toEqual({
      extract_concepts: 60_000,
      generate_materials: 60_000,
      evaluate_answer: 20_000,
    });
    expect(LLM_MAX_ATTEMPTS).toBe(3);
  });
});
