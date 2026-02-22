import { createLogger } from '@bematic/common';
import type { OfflineQueue } from '../gateway/offline-queue.js';
import type { ApiKeyService } from '../services/api-key.service.js';
import type { RetentionService } from '../services/retention.service.js';

const logger = createLogger('maintenance-worker');

export interface MaintenanceWorkerOptions {
  offlineQueueCleanIntervalMs?: number;
  offlineQueueMetricsIntervalMs?: number;
  apiKeyCleanIntervalMs?: number;
  retentionIntervalMs?: number;
  retentionStartupDelayMs?: number;
}

export class MaintenanceWorker {
  private intervals: NodeJS.Timeout[] = [];
  private timeouts: NodeJS.Timeout[] = [];

  constructor(
    private readonly offlineQueue: OfflineQueue,
    private readonly apiKeyService: ApiKeyService,
    private readonly retentionService: RetentionService,
    private readonly options: MaintenanceWorkerOptions = {},
  ) {}

  start(): void {
    const {
      offlineQueueCleanIntervalMs = 60_000,
      offlineQueueMetricsIntervalMs = 5 * 60 * 1000,
      apiKeyCleanIntervalMs = 6 * 60 * 60 * 1000,
      retentionIntervalMs = 24 * 60 * 60 * 1000,
      retentionStartupDelayMs = 5 * 60 * 1000,
    } = this.options;

    // Clean expired offline queue entries every minute
    this.intervals.push(
      setInterval(() => {
        const cleaned = this.offlineQueue.cleanExpired();
        if (cleaned > 0) logger.info({ cleaned }, 'Cleaned expired offline queue entries');
      }, offlineQueueCleanIntervalMs),
    );

    // Log offline queue metrics every 5 minutes
    this.intervals.push(
      setInterval(() => {
        const m = this.offlineQueue.getMetrics();
        if (m.totalMessages > 0) {
          logger.info(
            { ...m, successRate: ((m.successfulDeliveries / m.totalMessages) * 100).toFixed(2) + '%' },
            'Offline queue performance metrics',
          );
        }
      }, offlineQueueMetricsIntervalMs),
    );

    // Clean expired/revoked API keys every 6 hours
    this.intervals.push(
      setInterval(() => {
        try {
          const result = this.apiKeyService.cleanupExpiredKeys();
          if (result.deleted > 0) logger.info({ deleted: result.deleted }, 'Cleaned expired/revoked API keys');
        } catch (error) {
          logger.error({ error }, 'Error during API key cleanup');
        }
      }, apiKeyCleanIntervalMs),
    );

    // Retention cleanup every 24 hours
    this.intervals.push(setInterval(() => this.runRetentionCleanup(), retentionIntervalMs));

    // Initial retention run after startup delay
    this.timeouts.push(setTimeout(() => this.runRetentionCleanup(), retentionStartupDelayMs));

    logger.info('Maintenance worker started');
  }

  stop(): void {
    for (const interval of this.intervals) clearInterval(interval);
    for (const timeout of this.timeouts) clearTimeout(timeout);
    this.intervals = [];
    this.timeouts = [];
    logger.info('Maintenance worker stopped');
  }

  private async runRetentionCleanup(): Promise<void> {
    try {
      logger.info('Starting scheduled retention cleanup');
      const results = await this.retentionService.runRetentionPolicies();
      const totalDeleted =
        results.tasksDeleted + results.sessionsDeleted +
        results.auditLogsDeleted + results.offlineQueueDeleted;
      logger.info({ ...results, totalDeleted }, 'Retention cleanup completed');
    } catch (error) {
      logger.error({ error }, 'Error during retention cleanup');
    }
  }
}
