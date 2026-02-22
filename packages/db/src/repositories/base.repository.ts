import type { DB } from '../connection.js';

/**
 * Minimal metrics interface - injected by the consuming application (cloud) to avoid
 * a circular dependency between the db and cloud packages.
 */
export interface DBMetrics {
  increment(name: string, value?: number): void;
  histogram(name: string, value: number): void;
}

let _injectedMetrics: DBMetrics | null = null;

/**
 * Inject a metrics implementation. Called once at startup by the cloud package.
 * If not called (e.g. in tests), metrics tracking is silently skipped.
 */
export function setRepositoryMetrics(m: DBMetrics): void {
  _injectedMetrics = m;
}

export abstract class BaseRepository {
  constructor(protected readonly db: DB) {}

  /**
   * Track synchronous database query performance
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
      if (_injectedMetrics) {
        _injectedMetrics.increment('db.queries.total');
        _injectedMetrics.increment(`db.queries.${operation}`);
        _injectedMetrics.histogram('db.query.duration', duration);
        _injectedMetrics.increment(success ? 'db.queries.success' : 'db.queries.errors');
        if (duration > 500) _injectedMetrics.increment('db.queries.slow');
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
      if (_injectedMetrics) {
        _injectedMetrics.increment('db.queries.total');
        _injectedMetrics.increment(`db.queries.${operation}`);
        _injectedMetrics.histogram('db.query.duration', duration);
        _injectedMetrics.increment(success ? 'db.queries.success' : 'db.queries.errors');
        if (duration > 500) _injectedMetrics.increment('db.queries.slow');
      }
    }
  }
}
