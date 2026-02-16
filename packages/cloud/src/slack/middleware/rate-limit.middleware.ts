import { RateLimitError, createLogger } from '@bematic/common';
import type { Config } from '../../config.js';

const logger = createLogger('rate-limit');

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const userRateLimits = new Map<string, RateLimitEntry>();

export function createRateLimiter(config: Config) {
  return {
    check(userId: string, override?: number | null): void {
      const maxRequests = override ?? config.rateLimit.maxRequests;
      const windowMs = config.rateLimit.windowMs;
      const now = Date.now();

      let entry = userRateLimits.get(userId);

      if (!entry || now - entry.windowStart > windowMs) {
        entry = { count: 0, windowStart: now };
        userRateLimits.set(userId, entry);
      }

      entry.count++;

      if (entry.count > maxRequests) {
        const retryAfterMs = entry.windowStart + windowMs - now;
        logger.warn({ userId, count: entry.count, maxRequests }, 'Rate limit exceeded');
        throw new RateLimitError(retryAfterMs);
      }
    },

    reset(userId: string): void {
      userRateLimits.delete(userId);
    },
  };
}
