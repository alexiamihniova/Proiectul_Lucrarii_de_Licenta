import type { LlmOperation } from '../../core/domain.js';
import type {
  EvaluateAnswerInput,
  EvaluateAnswerOutput,
  ExtractConceptsInput,
  ExtractConceptsOutput,
  GenerateMaterialsInput,
  GenerateMaterialsOutput,
} from './schemas.js';

/**
 * The single abstraction over the language model (SRS 3.5: one model, called only from the
 * server, replaceable from configuration).
 *
 * Contract of an implementation:
 *  - one method call = ONE request to the provider. No retries, no database access, no
 *    logging to `llm_calls`, no source verification — those belong to the callers
 *    (Segment 3: retry ≤ 2 times, record every attempt, verify sources).
 *  - it resolves only with output that parses with the matching *Output schema;
 *  - every failure is thrown as an `LLMError` with a `kind`; it never throws anything else;
 *  - it honours `options.timeoutMs` and `options.signal`;
 *  - it never logs prompt or passage text.
 */
export interface LLMClient {
  /** Identifier of the configured model, recorded with each call. */
  readonly model: string;

  extractConcepts(
    input: ExtractConceptsInput,
    options?: LLMCallOptions,
  ): Promise<LLMResult<ExtractConceptsOutput>>;

  generateMaterials(
    input: GenerateMaterialsInput,
    options?: LLMCallOptions,
  ): Promise<LLMResult<GenerateMaterialsOutput>>;

  evaluateAnswer(
    input: EvaluateAnswerInput,
    options?: LLMCallOptions,
  ): Promise<LLMResult<EvaluateAnswerOutput>>;
}

export interface LLMCallOptions {
  /** Defaults to LLM_TIMEOUTS_MS[operation]. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  /** Estimated cost of this request, in USD. */
  estimated_cost: number;
}

export interface LLMResult<T> {
  output: T;
  usage: LLMUsage;
}

/** SRS Tabelul 3.3: 60 s, 60 s, 20 s. */
export const LLM_TIMEOUTS_MS: Record<LlmOperation, number> = {
  extract_concepts: 60_000,
  generate_materials: 60_000,
  evaluate_answer: 20_000,
};

/** SRS 3.1.3: an invalid or failed call is retried at most twice (3 attempts in total). */
export const LLM_MAX_ATTEMPTS = 3;

export type LLMErrorKind =
  /** No reply within the timeout. → llm_calls.status = 'timeout' */
  | 'timeout'
  /** The reply is not JSON or does not match the *Output schema (R1). → 'invalid_response' */
  | 'invalid_response'
  /** Provider rate limit. → 'error' */
  | 'rate_limited'
  /** Network failure, 5xx, authentication or any other provider error. → 'error' */
  | 'unavailable';

export class LLMError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    readonly operation: LlmOperation,
    message: string,
    /** Provider-specific code (HTTP status, error type) for llm_calls.error_code (C-06). */
    readonly providerCode?: string,
    /** Usage consumed by the failed request, when the provider reports it. */
    readonly usage?: Partial<LLMUsage>,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
