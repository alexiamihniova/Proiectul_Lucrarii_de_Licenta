import { describe, expect, it } from 'vitest';
import { startWorker } from '../src/core/worker.js';

const silent = { info: () => undefined, error: () => undefined };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('worker runtime', () => {
  it('runs each task repeatedly on its interval', async () => {
    let runs = 0;
    const worker = startWorker(
      [{ name: 'tick', intervalMs: 5, run: async () => void runs++ }],
      silent,
    );
    await wait(60);
    await worker.stop();
    expect(runs).toBeGreaterThanOrEqual(3);
  });

  it('never runs a task concurrently with itself', async () => {
    let active = 0;
    let maxActive = 0;
    const worker = startWorker(
      [
        {
          name: 'slow',
          intervalMs: 1,
          run: async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await wait(15);
            active -= 1;
          },
        },
      ],
      silent,
    );
    await wait(70);
    await worker.stop();
    expect(maxActive).toBe(1);
  });

  it('logs a failing task and keeps going', async () => {
    const errors: object[] = [];
    let runs = 0;
    const worker = startWorker(
      [
        {
          name: 'flaky',
          intervalMs: 5,
          run: async () => {
            runs += 1;
            throw new Error('boom');
          },
        },
      ],
      { info: () => undefined, error: (obj) => errors.push(obj) },
    );
    await wait(50);
    await worker.stop();
    expect(runs).toBeGreaterThanOrEqual(2);
    expect(errors[0]).toMatchObject({ task: 'flaky' });
  });

  it('stop() aborts the signal, waits for the running task and schedules nothing more', async () => {
    let finished = false;
    let aborted = false;
    let runs = 0;
    const worker = startWorker(
      [
        {
          name: 'long',
          intervalMs: 1,
          run: async (signal) => {
            runs += 1;
            await wait(30);
            aborted = signal.aborted;
            finished = true;
          },
        },
      ],
      silent,
    );
    await wait(10);
    await worker.stop();
    expect(finished).toBe(true);
    expect(aborted).toBe(true);
    const after = runs;
    await wait(30);
    expect(runs).toBe(after);
  });
});
