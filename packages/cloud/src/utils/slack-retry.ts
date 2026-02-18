import { createLogger } from '@bematic/common';

const logger = createLogger('slack-retry');

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  shouldRetry: (error: unknown) => {
    // Retry on rate limits and transient errors
    const errorCode = (error as any)?.data?.error;
    if (!errorCode) {
      return true; // Unknown error, retry
    }

    // Always retry rate limits
    if (errorCode === 'rate_limited') {
      return true;
    }

    // Retry transient errors
    const transientErrors = [
      'internal_error',
      'service_unavailable',
      'timeout',
      'fatal_error',
    ];
    return transientErrors.includes(errorCode);
  },
};

/**
 * Wraps a Slack API call with exponential backoff retry logic
 */
export async function withSlackRetry<T>(
  fn: () => Promise<T>,
  context: { operation: string; channel?: string },
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      if (!opts.shouldRetry(error)) {
        logger.warn(
          { error, operation: context.operation, channel: context.channel },
          'Slack API error is not retryable',
        );
        throw error;
      }

      // Check if this was the last attempt
      if (attempt >= opts.maxRetries) {
        logger.error(
          {
            error,
            operation: context.operation,
            channel: context.channel,
            attempts: attempt + 1,
          },
          'Slack API call failed after max retries',
        );
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = opts.baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 1000; // 0-1000ms jitter
      const delay = Math.min(exponentialDelay + jitter, opts.maxDelayMs);

      // Check for rate limit retry-after header
      const retryAfter = (error as any)?.data?.retry_after;
      const finalDelay = retryAfter ? retryAfter * 1000 : delay;

      logger.warn(
        {
          error: (error as any)?.data?.error || error,
          operation: context.operation,
          channel: context.channel,
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          delayMs: finalDelay,
        },
        'Slack API call failed, retrying...',
      );

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, finalDelay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Queue for failed Slack notifications that couldn't be delivered
 * These can be retried later or logged for manual review
 */
export class FailedNotificationQueue {
  private queue: Array<{
    timestamp: Date;
    operation: string;
    channel: string;
    data: unknown;
    error: string;
  }> = [];

  private maxSize = 1000;

  enqueue(operation: string, channel: string, data: unknown, error: unknown): void {
    if (this.queue.length >= this.maxSize) {
      // Remove oldest entry
      this.queue.shift();
    }

    this.queue.push({
      timestamp: new Date(),
      operation,
      channel,
      data,
      error: error instanceof Error ? error.message : String(error),
    });

    logger.warn(
      { operation, channel, queueSize: this.queue.length },
      'Slack notification queued for retry',
    );
  }

  getAll() {
    return [...this.queue];
  }

  clear(): void {
    const size = this.queue.length;
    this.queue = [];
    logger.info({ clearedCount: size }, 'Failed notification queue cleared');
  }

  size(): number {
    return this.queue.length;
  }
}
