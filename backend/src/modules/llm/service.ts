import type { Config } from '../../core/config.js';
import type { LLMClient } from './client.js';
import { FakeLLMClient } from './fake.js';

/**
 * Public surface of the llm module. Other modules import ONLY from this file.
 *
 * Foundation (Segment 0) provides: the LLMClient interface, the operation schemas, the fake
 * client and the factory below.
 *
 * Segment 3 adds here:
 *  - the real client for the configured provider (one more `case` in `createLlmClient`);
 *  - an `LlmService` wrapping the client: retries (≤ LLM_MAX_ATTEMPTS), one `llm_calls` row per
 *    attempt through ./repository.ts (C-06), mapping of exhausted retries to
 *    `AppError('LLM_UNAVAILABLE')` (M07).
 */
export * from './client.js';
export * from './schemas.js';
export { FakeLLMClient } from './fake.js';
export type { FakeLLMCall } from './fake.js';

export function createLlmClient(config: Config): LLMClient {
  switch (config.llm.provider) {
    case 'fake':
      return new FakeLLMClient();
    default:
      throw new Error(
        `LLM_PROVIDER="${config.llm.provider}" is not implemented yet (Segment 3). Use LLM_PROVIDER=fake.`,
      );
  }
}
