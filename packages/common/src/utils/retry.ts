import type { Logger } from './logger.js';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitter: true,
};

export function calculateBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: boolean,
): number {
  const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  if (!jitter) return delay;
  return delay * (0.5 + Math.random() * 0.5);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
  logger?: Logger,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < opts.maxAttempts - 1) {
        const delay = calculateBackoff(
          attempt,
          opts.baseDelayMs,
          opts.maxDelayMs,
          opts.jitter,
        );
        logger?.warn(
          { attempt: attempt + 1, maxAttempts: opts.maxAttempts, delay, error: lastError.message },
          'Retrying after failure',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
