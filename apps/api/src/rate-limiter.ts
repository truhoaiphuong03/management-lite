export interface RateLimiterOptions {
  windowMs?: number;
  maxAttempts?: number;
}

interface AttemptRecord {
  timestamps: number[];
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxAttempts: number;
  private readonly attempts = new Map<string, AttemptRecord>();
  private lastPrunedAt: number = Date.now();

  constructor(options: RateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 15 * 60 * 1000; // 15 minutes default
    this.maxAttempts = options.maxAttempts ?? 5; // 5 attempts per window default
  }

  /**
   * Checks if an action is allowed for the given key without incrementing the counter.
   */
  public check(key: string): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  } {
    this.maybePrune();
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record) {
      return {
        allowed: true,
        remaining: this.maxAttempts,
        retryAfterSeconds: 0,
      };
    }

    const validTimestamps = record.timestamps.filter(
      (ts) => now - ts < this.windowMs,
    );
    record.timestamps = validTimestamps;

    if (validTimestamps.length >= this.maxAttempts) {
      const oldest = validTimestamps[0]!;
      const retryAfterMs = this.windowMs - (now - oldest);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    return {
      allowed: true,
      remaining: this.maxAttempts - validTimestamps.length,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Increments the attempt counter for the given key and checks if allowed.
   */
  public increment(key: string): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  } {
    this.maybePrune();
    const now = Date.now();
    let record = this.attempts.get(key);

    if (!record) {
      record = { timestamps: [] };
      this.attempts.set(key, record);
    }

    record.timestamps = record.timestamps.filter(
      (ts) => now - ts < this.windowMs,
    );

    record.timestamps.push(now);

    if (record.timestamps.length > this.maxAttempts) {
      const oldest = record.timestamps[0]!;
      const retryAfterMs = this.windowMs - (now - oldest);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    return {
      allowed: true,
      remaining: this.maxAttempts - record.timestamps.length,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Resets the attempt counter for a specific key (e.g. after successful login).
   */
  public reset(key: string): void {
    this.attempts.delete(key);
  }

  /**
   * Clears all recorded attempts.
   */
  public clear(): void {
    this.attempts.clear();
  }

  private maybePrune(): void {
    const now = Date.now();
    // Prune expired entries every 5 minutes or if map exceeds 10,000 entries
    if (
      now - this.lastPrunedAt > 5 * 60 * 1000 ||
      this.attempts.size > 10_000
    ) {
      for (const [key, record] of this.attempts.entries()) {
        const valid = record.timestamps.filter(
          (ts) => now - ts < this.windowMs,
        );
        if (valid.length === 0) {
          this.attempts.delete(key);
        } else {
          record.timestamps = valid;
        }
      }
      this.lastPrunedAt = now;
    }
  }
}
