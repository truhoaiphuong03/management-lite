type Timer = unknown;

export interface PurgeSchedulerOptions {
  /** Runs one cleanup pass; resolves to the number of purged receipts. */
  run: () => Promise<number>;
  intervalMs?: number;
  /** Receives only a fixed message and the error class name, never error text or payloads. */
  logger?: { warn: (message: string) => void };
  /** Names the job in the failure log line. Defaults to the FIN receipt cleanup. */
  label?: string;
  setIntervalFn?: (fn: () => void, ms: number) => Timer;
  clearIntervalFn?: (t: Timer) => void;
}

export interface PurgeScheduler {
  /** Runs one pass now unless one is already in flight. Never rejects. */
  tick: () => Promise<void>;
  /** Stops the schedule and waits for the in-flight pass, if any. Never rejects. */
  stop: () => Promise<void>;
}

/**
 * Startup pass + periodic receipt cleanup. Passes never overlap, failures are logged without
 * detail and never propagate, and the timer is unref'd so it cannot keep the process alive.
 */
export function startPurgeScheduler(
  options: PurgeSchedulerOptions,
): PurgeScheduler {
  const setI = options.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
  const clearI =
    options.clearIntervalFn ??
    ((t: Timer) => clearInterval(t as Parameters<typeof clearInterval>[0]));
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  const tick = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await options.run();
      } catch (err) {
        const kind = err instanceof Error ? err.name : 'UnknownError';
        try {
          options.logger?.warn(
            `${options.label ?? 'FIN receipt'} cleanup failed (${kind})`,
          );
        } catch {
          // logging must never affect the server
        }
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };
  const timer = setI(() => void tick(), options.intervalMs ?? 60 * 60 * 1000);
  (timer as { unref?: () => void }).unref?.();
  void tick();
  return {
    tick,
    stop: async () => {
      stopped = true;
      clearI(timer);
      await inFlight;
    },
  };
}
