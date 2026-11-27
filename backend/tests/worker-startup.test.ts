import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../src/core/config.js';
import { MAX_POLL_INTERVAL_MS, assertPollInterval } from '../src/core/worker.js';
import { VALID_ENV } from './helpers/env.js';

/** Q13, C-02: the worker looks at the queue at least every 3 s, and refuses to start otherwise. */
describe('the poll interval of the worker', () => {
  it('is at most 3000 ms', () => {
    expect(MAX_POLL_INTERVAL_MS).toBe(3000);
  });

  it.each([100, 1000, 3000])('accepts %i ms', (interval) => {
    expect(() => assertPollInterval(interval)).not.toThrow();
  });

  it.each([3001, 5000, 60_000])(
    'refuses %i ms with a message that names the variable and the limit',
    (interval) => {
      expect(() => assertPollInterval(interval)).toThrow(ConfigError);
      try {
        assertPollInterval(interval);
      } catch (error) {
        const message = (error as ConfigError).problems.join('\n');
        expect(message).toContain(`WORKER_POLL_INTERVAL_MS=${interval}`);
        expect(message).toContain('3000');
        expect(message).toMatch(/Q13|C-02/);
      }
    },
  );

  it('is refused by the worker process itself, before it opens the database, and not cut quietly', () => {
    const result = spawnSync(resolve('node_modules/.bin/tsx'), ['src/worker.ts'], {
      env: { ...VALID_ENV, PATH: process.env.PATH ?? '', WORKER_POLL_INTERVAL_MS: '5000' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(1);
    const failure = JSON.parse(result.stderr.trim().split('\n').pop()!) as {
      error: string;
      config_error: boolean;
    };
    expect(failure.config_error).toBe(true);
    expect(failure.error).toContain('WORKER_POLL_INTERVAL_MS=5000');
    expect(failure.error).toContain('3000');
  });

  it('is accepted by the default configuration (1000 ms)', () => {
    expect(() => assertPollInterval(1000)).not.toThrow();
  });
});
