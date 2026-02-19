import { createLogger } from '../utils/logger.js';
import type { CacheManager } from '../cache/cache-manager.js';

const logger = createLogger('performance-monitor');

export interface PerformanceMetrics {
  fileOperations: {
    totalCount: number;
    totalDuration: number;
    averageDuration: number;
    errors: number;
    errorRate: number;
  };
  cache: {
    totalHits: number;
    totalMisses: number;
    hitRate: number;
    memoryUsage: number;
    entriesCount: number;
  };
  database: {
    totalQueries: number;
    totalDuration: number;
    averageDuration: number;
    slowQueries: number;
    errors: number;
  };
  websocket: {
    totalMessages: number;
    messagesPerSecond: number;
    activeConnections: number;
    errorCount: number;
  };
  agents: {
    totalOnline: number;
    totalTasks: number;
    averageTaskDuration: number;
    taskCompletionRate: number;
  };
}

export interface PerformanceEvent {
  type: 'file_operation' | 'cache_access' | 'db_query' | 'websocket_message' | 'task_execution';
  operation: string;
  duration: number;
  success: boolean;
  metadata?: Record<string, any>;
  timestamp: number;
}

export class PerformanceMonitor {
  private events: PerformanceEvent[] = [];
  private readonly maxEvents: number;
  private readonly aggregationInterval: number;
  private intervalId: NodeJS.Timeout | null = null;

  private metrics: PerformanceMetrics = {
    fileOperations: {
      totalCount: 0,
      totalDuration: 0,
      averageDuration: 0,
      errors: 0,
      errorRate: 0,
    },
    cache: {
      totalHits: 0,
      totalMisses: 0,
      hitRate: 0,
      memoryUsage: 0,
      entriesCount: 0,
    },
    database: {
      totalQueries: 0,
      totalDuration: 0,
      averageDuration: 0,
      slowQueries: 0,
      errors: 0,
    },
    websocket: {
      totalMessages: 0,
      messagesPerSecond: 0,
      activeConnections: 0,
      errorCount: 0,
    },
    agents: {
      totalOnline: 0,
      totalTasks: 0,
      averageTaskDuration: 0,
      taskCompletionRate: 0,
    },
  };

  constructor(
    maxEvents: number = 10000,
    aggregationIntervalMs: number = 60000,
  ) {
    this.maxEvents = maxEvents;
    this.aggregationInterval = aggregationIntervalMs;
    this.startAggregation();
  }

  recordEvent(event: Omit<PerformanceEvent, 'timestamp'>): void {
    const fullEvent: PerformanceEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.events.push(fullEvent);

    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    if (event.type === 'file_operation' && event.duration > 1000) {
      logger.warn(
        { operation: event.operation, duration: event.duration, success: event.success },
        'Slow file operation detected',
      );
    }

    if (event.type === 'db_query' && event.duration > 500) {
      logger.warn(
        { operation: event.operation, duration: event.duration, success: event.success },
        'Slow database query detected',
      );
    }
  }

  async recordFileOperation<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>,
  ): Promise<T> {
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
      this.recordEvent({
        type: 'file_operation',
        operation,
        duration,
        success,
        metadata,
      });
    }
  }

  recordDatabaseQuery<T>(
    operation: string,
    fn: () => T,
    metadata?: Record<string, any>,
  ): T {
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
      this.recordEvent({
        type: 'db_query',
        operation,
        duration,
        success,
        metadata,
      });
    }
  }

  updateCacheMetrics(caches: Record<string, CacheManager>): void {
    let totalHits = 0;
    let totalMisses = 0;
    let totalMemory = 0;
    let totalEntries = 0;

    for (const [_name, cache] of Object.entries(caches)) {
      const stats = cache.getStats();
      totalHits += stats.hits;
      totalMisses += stats.misses;
      totalMemory += stats.memoryUsage;
      totalEntries += stats.entries;
    }

    this.metrics.cache = {
      totalHits,
      totalMisses,
      hitRate: totalHits + totalMisses > 0 ? totalHits / (totalHits + totalMisses) : 0,
      memoryUsage: totalMemory,
      entriesCount: totalEntries,
    };
  }

  getMetrics(): PerformanceMetrics {
    this.aggregateMetrics();
    return { ...this.metrics };
  }

  getEvents(type?: PerformanceEvent['type'], limit?: number): PerformanceEvent[] {
    let filtered = this.events;

    if (type) {
      filtered = filtered.filter(event => event.type === type);
    }

    if (limit) {
      filtered = filtered.slice(-limit);
    }

    return filtered;
  }

  getSummary(minutes: number = 5): {
    timeRange: string;
    totalEvents: number;
    errorRate: number;
    averageResponseTime: number;
    slowOperations: number;
    topOperations: Array<{ operation: string; count: number; avgDuration: number }>;
  } {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);
    const recentEvents = this.events.filter(e => e.timestamp >= cutoffTime);

    if (recentEvents.length === 0) {
      return {
        timeRange: `Last ${minutes} minutes`,
        totalEvents: 0,
        errorRate: 0,
        averageResponseTime: 0,
        slowOperations: 0,
        topOperations: [],
      };
    }

    const errors = recentEvents.filter(e => !e.success).length;
    const errorRate = errors / recentEvents.length;
    const averageResponseTime = recentEvents.reduce((sum, e) => sum + e.duration, 0) / recentEvents.length;
    const slowOperations = recentEvents.filter(e => e.duration > 1000).length;

    const operationStats = new Map<string, { count: number; totalDuration: number }>();

    for (const event of recentEvents) {
      const key = `${event.type}:${event.operation}`;
      const existing = operationStats.get(key) || { count: 0, totalDuration: 0 };
      existing.count++;
      existing.totalDuration += event.duration;
      operationStats.set(key, existing);
    }

    const topOperations = Array.from(operationStats.entries())
      .map(([operation, stats]) => ({
        operation,
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      timeRange: `Last ${minutes} minutes`,
      totalEvents: recentEvents.length,
      errorRate,
      averageResponseTime,
      slowOperations,
      topOperations,
    };
  }

  clear(): void {
    this.events = [];
    this.metrics = {
      fileOperations: {
        totalCount: 0,
        totalDuration: 0,
        averageDuration: 0,
        errors: 0,
        errorRate: 0,
      },
      cache: {
        totalHits: 0,
        totalMisses: 0,
        hitRate: 0,
        memoryUsage: 0,
        entriesCount: 0,
      },
      database: {
        totalQueries: 0,
        totalDuration: 0,
        averageDuration: 0,
        slowQueries: 0,
        errors: 0,
      },
      websocket: {
        totalMessages: 0,
        messagesPerSecond: 0,
        activeConnections: 0,
        errorCount: 0,
      },
      agents: {
        totalOnline: 0,
        totalTasks: 0,
        averageTaskDuration: 0,
        taskCompletionRate: 0,
      },
    };
  }

  private startAggregation(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      this.aggregateMetrics();
    }, this.aggregationInterval);
  }

  private aggregateMetrics(): void {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const recentEvents = this.events.filter(e => e.timestamp >= oneHourAgo);

    const fileOps = recentEvents.filter(e => e.type === 'file_operation');
    if (fileOps.length > 0) {
      const totalDuration = fileOps.reduce((sum, e) => sum + e.duration, 0);
      const errors = fileOps.filter(e => !e.success).length;

      this.metrics.fileOperations = {
        totalCount: fileOps.length,
        totalDuration,
        averageDuration: totalDuration / fileOps.length,
        errors,
        errorRate: errors / fileOps.length,
      };
    }

    const dbQueries = recentEvents.filter(e => e.type === 'db_query');
    if (dbQueries.length > 0) {
      const totalDuration = dbQueries.reduce((sum, e) => sum + e.duration, 0);
      const slowQueries = dbQueries.filter(e => e.duration > 500).length;
      const errors = dbQueries.filter(e => !e.success).length;

      this.metrics.database = {
        totalQueries: dbQueries.length,
        totalDuration,
        averageDuration: totalDuration / dbQueries.length,
        slowQueries,
        errors,
      };
    }

    const wsMessages = recentEvents.filter(e => e.type === 'websocket_message');
    const messagesPerSecond = wsMessages.length / 3600;
    const wsErrors = wsMessages.filter(e => !e.success).length;

    this.metrics.websocket = {
      totalMessages: wsMessages.length,
      messagesPerSecond,
      activeConnections: 0,
      errorCount: wsErrors,
    };

    const taskEvents = recentEvents.filter(e => e.type === 'task_execution');
    if (taskEvents.length > 0) {
      const totalDuration = taskEvents.reduce((sum, e) => sum + e.duration, 0);
      const completed = taskEvents.filter(e => e.success).length;

      this.metrics.agents = {
        totalOnline: 0,
        totalTasks: taskEvents.length,
        averageTaskDuration: totalDuration / taskEvents.length,
        taskCompletionRate: completed / taskEvents.length,
      };
    }
  }

  destroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
