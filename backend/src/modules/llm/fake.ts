import type { LlmOperation } from '../../core/domain.js';
import type { LLMCallOptions, LLMClient, LLMErrorKind, LLMResult, LLMUsage } from './client.js';
import { LLMError } from './client.js';
import { EvaluateAnswerOutput, ExtractConceptsOutput, GenerateMaterialsOutput } from './schemas.js';
import type {
  EvaluateAnswerInput,
  ExtractConceptsInput,
  GenerateMaterialsInput,
  GeneratedMaterial,
} from './schemas.js';

export interface FakeLLMCall {
  operation: LlmOperation;
  input: unknown;
  options?: LLMCallOptions;
}

type Scripted = { error: LLMErrorKind } | { output: unknown };

/**
 * Deterministic in-memory LLMClient for tests and for local development without a key
 * (LLM_PROVIDER=fake). It makes no network calls.
 *
 * Default behaviour: builds plausible output from the input, quoting real passage text, so
 * that source verification succeeds. To exercise failure paths, script the next replies:
 *
 *   fake.enqueue('generate_materials', { error: 'timeout' });           // next call throws
 *   fake.enqueue('generate_materials', { output: { materials: [...] } }); // call after returns this
 *
 * A scripted output that does not match the *Output schema is turned into an
 * `invalid_response` LLMError, exactly like a real implementation must do.
 */
export class FakeLLMClient implements LLMClient {
  readonly model = 'fake-model';
  readonly calls: FakeLLMCall[] = [];
  private readonly scripted = new Map<LlmOperation, Scripted[]>();

  enqueue(operation: LlmOperation, reply: Scripted): this {
    const queue = this.scripted.get(operation) ?? [];
    queue.push(reply);
    this.scripted.set(operation, queue);
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.scripted.clear();
  }

  async extractConcepts(input: ExtractConceptsInput, options?: LLMCallOptions) {
    return this.reply('extract_concepts', input, options, ExtractConceptsOutput, () => ({
      concepts: input.passages.slice(0, 100).map((passage, index) => ({
        name: `Concept ${index + 1}: ${firstWords(passage.text, 3)}`.slice(0, 80),
        definition: firstWords(passage.text, 20).slice(0, 300),
        passage_ids: [passage.id],
      })),
    }));
  }

  async generateMaterials(input: GenerateMaterialsInput, options?: LLMCallOptions) {
    return this.reply('generate_materials', input, options, GenerateMaterialsOutput, () => ({
      materials: Array.from({ length: input.count }, (_, index): GeneratedMaterial => {
        const passage = input.passages[index % input.passages.length]!;
        const quote = firstWords(passage.text, 8);
        const base = { passage_id: passage.id, quote, explanation: `Vezi pasajul ${passage.id}.` };
        const label = `${input.concept.name} (${index + 1})`;
        switch (input.type) {
          case 'summary':
            return {
              ...base,
              type: 'summary',
              statement: `Rezumat ${label}: ${quote}`,
              answer: null,
              options: null,
            };
          case 'flashcard':
            return {
              ...base,
              type: 'flashcard',
              statement: `Ce este ${label}?`,
              answer: input.concept.definition || quote,
              options: null,
            };
          case 'multiple_choice':
            return {
              ...base,
              type: 'multiple_choice',
              statement: `Care afirmație descrie ${label}?`,
              answer: quote,
              options: [quote, 'Varianta B', 'Varianta C', 'Varianta D'],
            };
          case 'true_false':
            return {
              ...base,
              type: 'true_false',
              statement: `${label}: „${quote}”`,
              answer: 'true',
              options: null,
            };
          case 'open':
            return {
              ...base,
              type: 'open',
              statement: `Explică ${label}.`,
              answer: input.concept.definition || quote,
              options: null,
            };
        }
      }),
    }));
  }

  async evaluateAnswer(input: EvaluateAnswerInput, options?: LLMCallOptions) {
    return this.reply('evaluate_answer', input, options, EvaluateAnswerOutput, () => {
      const given = normalize(input.student_answer);
      const reference = normalize(input.reference_answer);
      if (given.length === 0) return { verdict: 'incorrect' as const, explanation: 'Răspuns gol.' };
      if (given === reference)
        return { verdict: 'complete' as const, explanation: 'Răspuns complet.' };
      const overlap = reference.split(' ').some((word) => word.length > 3 && given.includes(word));
      return overlap
        ? { verdict: 'partial' as const, explanation: 'Răspuns parțial.' }
        : { verdict: 'incorrect' as const, explanation: 'Răspuns incorect.' };
    });
  }

  private async reply<T>(
    operation: LlmOperation,
    input: unknown,
    options: LLMCallOptions | undefined,
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    build: () => unknown,
  ): Promise<LLMResult<T>> {
    this.calls.push({ operation, input, options });
    if (options?.signal?.aborted) {
      throw new LLMError('unavailable', operation, 'fake: call aborted', 'ABORTED');
    }
    const next = this.scripted.get(operation)?.shift();
    if (next && 'error' in next) {
      throw new LLMError(
        next.error,
        operation,
        `fake: scripted ${next.error}`,
        `FAKE_${next.error.toUpperCase()}`,
      );
    }
    const parsed = schema.safeParse(next ? next.output : build());
    if (!parsed.success) {
      throw new LLMError(
        'invalid_response',
        operation,
        'fake: output does not match the schema',
        'FAKE_INVALID_RESPONSE',
      );
    }
    return { output: parsed.data, usage: fakeUsage(input, parsed.data) };
  }
}

function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).slice(0, count).join(' ');
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Deterministic usage numbers (≈ 4 characters per token) so cost reports can be tested. */
function fakeUsage(input: unknown, output: unknown): LLMUsage {
  const input_tokens = Math.ceil(JSON.stringify(input).length / 4);
  const output_tokens = Math.ceil(JSON.stringify(output).length / 4);
  return { input_tokens, output_tokens, duration_ms: 1, estimated_cost: 0 };
}
