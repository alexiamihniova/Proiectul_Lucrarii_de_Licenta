import { ConfigError } from './config.js';

/**
 * Background work runtime (ADR-0003). `src/worker.ts` is a separate process from the HTTP
 * server; it runs a list of tasks, each on its own interval. A task is a plain async function
 * registered by the module that owns the work:
 *
 *   - Segment 2/3: claim one `queued` document (FOR UPDATE SKIP LOCKED) and analyse it;
 *                  fail documents stuck in `processing` for more than 60 s (PE).
 *   - Segment 8:   send due reminders; delete expired password-reset tokens.
 *   - Segment 7:   delete llm_calls older than the retention period.
 *
 * The runtime knows nothing about what tasks do.
 */

/**
 * The longest a worker may wait between two looks at the queue (Q13, C-02): the state of a document
 * must show in the interface within 5 s, and the interface polls every 3 s, so a worker that looks
 * less often than that would make the 5 s impossible.
 */
export const MAX_POLL_INTERVAL_MS = 3000;

/**
 * Refuses, at start-up, a poll interval above `MAX_POLL_INTERVAL_MS`. It does not shorten the value
 * quietly: whoever set it must know it was wrong.
 */
export function assertPollInterval(pollIntervalMs: number): void {
  if (pollIntervalMs > MAX_POLL_INTERVAL_MS) {
    throw new ConfigError([
      `WORKER_POLL_INTERVAL_MS=${pollIntervalMs} is above ${MAX_POLL_INTERVAL_MS} ms: a document ` +
        `would wait that long before its analysis even starts, and its state would not reach the ` +
        `interface within 5 s (Q13, C-02). Set it to ${MAX_POLL_INTERVAL_MS} or less.`,
    ]);
  }
}

export interface WorkerTask {
  name: string;
  intervalMs: number;
  run(signal: AbortSignal): Promise<void>;
}

export interface WorkerLogger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface WorkerHandle {
  /** Stops scheduling, aborts the signal and waits for running tasks to settle. */
  stop(): Promise<void>;
}

export function startWorker(tasks: WorkerTask[], log: WorkerLogger): WorkerHandle {
  const controller = new AbortController();
  const timers = new Set<NodeJS.Timeout>();
  const running = new Set<Promise<void>>();

  const schedule = (task: WorkerTask, delay: number) => {
    if (controller.signal.aborted) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      const execution = task
        .run(controller.signal)
        .catch((error: unknown) => log.error({ task: task.name, err: error }, 'worker task failed'))
        .finally(() => {
          running.delete(execution);
          // Re-arm only after the previous run finished: a task never overlaps itself.
          schedule(task, task.intervalMs);
        });
      running.add(execution);
    }, delay);
    timers.add(timer);
  };

  for (const task of tasks) schedule(task, 0);
  log.info({ tasks: tasks.map((task) => task.name) }, 'worker started');

  return {
    async stop() {
      controller.abort();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      await Promise.allSettled([...running]);
      log.info({}, 'worker stopped');
    },
  };
}
