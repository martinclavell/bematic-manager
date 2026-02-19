import type { DB } from '../connection.js';

// Simple metrics interface to avoid circular dependencies
interface SimpleMetrics {
  increment: (name: string, value?: number) => void;
  histogram: (name: string, value: number) => void;
}

// Lazy-loaded metrics to avoid circular dependencies
let metrics: SimpleMetrics | null = null;
const getMetrics = (): SimpleMetrics | null => {
  if (!metrics) {
    try {
      // Import metrics lazily to avoid circular dependency
      const metricsModule = require('../../cloud/src/utils/metrics.js');
      metrics = metricsModule.metrics;
    } catch (error) {
      // Metrics not available (e.g., in tests or different package contexts)
      metrics = null;
    }
  }
  return metrics;
};

export abstract class BaseRepository {
  constructor(protected readonly db: DB) {}

  /**
   * Track database query performance
   */
  protected trackQuery<T>(operation: string, fn: () => T): T {
    const startTime = Date.now();
    let success = false;

    try {
      const result = fn();
      success = true;
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      const metrics = getMetrics();

      if (metrics) {
        metrics.increment('db.queries.total');
        metrics.increment(`db.queries.${operation}`);
        metrics.histogram('db.query.duration', duration);

        if (success) {
          metrics.increment('db.queries.success');
        } else {
          metrics.increment('db.queries.errors');
        }

        if (duration > 500) {
          metrics.increment('db.queries.slow');
        }
      }
    }
  }

  /**
   * Track async database operations
   */
  protected async trackAsyncQuery<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    let success = false;

    try {
      const result = await fn();
      success = true;
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      const metrics = getMetrics();

      if (metrics) {
        metrics.increment('db.queries.total');
        metrics.increment(`db.queries.${operation}`);
        metrics.histogram('db.query.duration', duration);

        if (success) {
          metrics.increment('db.queries.success');
        } else {
          metrics.increment('db.queries.errors');
        }

        if (duration > 500) {
          metrics.increment('db.queries.slow');
        }
      }
    }
  }
}
