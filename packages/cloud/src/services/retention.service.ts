import { createLogger } from '@bematic/common';
import type {
  TaskRepository,
  AuditLogRepository,
  OfflineQueueRepository,
  SessionRepository,
} from '@bematic/db';

const logger = createLogger('retention');

export interface RetentionConfig {
  /** Delete completed/failed tasks older than this many days */
  taskRetentionDays: number;
  /** Delete audit logs older than this many days */
  auditLogRetentionDays: number;
  /** Delete offline queue entries older than this many hours */
  offlineQueueRetentionHours: number;
  /** Archive tasks to separate table before deletion */
  archiveBeforeDelete: boolean;
}

const DEFAULT_CONFIG: RetentionConfig = {
  taskRetentionDays: 30,
  auditLogRetentionDays: 90,
  offlineQueueRetentionHours: 24,
  archiveBeforeDelete: false, // TODO: implement archiving
};

export class RetentionService {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly offlineQueueRepo: OfflineQueueRepository,
    private readonly config: RetentionConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Run all retention policies
   * Returns total number of records deleted
   */
  async runRetentionPolicies(): Promise<{
    tasksDeleted: number;
    sessionsDeleted: number;
    auditLogsDeleted: number;
    offlineQueueDeleted: number;
  }> {
    logger.info('Starting retention policy execution');

    const results = {
      tasksDeleted: await this.cleanupOldTasks(),
      sessionsDeleted: await this.cleanupOrphanedSessions(),
      auditLogsDeleted: await this.cleanupOldAuditLogs(),
      offlineQueueDeleted: await this.cleanupOldOfflineQueue(),
    };

    const total =
      results.tasksDeleted +
      results.sessionsDeleted +
      results.auditLogsDeleted +
      results.offlineQueueDeleted;

    logger.info(
      {
        ...results,
        total,
      },
      'Retention policy execution completed',
    );

    return results;
  }

  /**
   * Delete completed/failed tasks older than retention period
   */
  private async cleanupOldTasks(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.taskRetentionDays);
    const cutoffISO = cutoffDate.toISOString();

    try {
      // Find old completed/failed/cancelled tasks
      const oldTasks = this.taskRepo.findAll().filter((task) => {
        const isTerminal = ['completed', 'failed', 'cancelled'].includes(task.status);
        const isOld = task.createdAt < cutoffISO;
        return isTerminal && isOld;
      });

      if (oldTasks.length === 0) {
        logger.debug('No old tasks to clean up');
        return 0;
      }

      // TODO: Archive tasks before deletion if config.archiveBeforeDelete is true
      // This would involve creating an archived_tasks table and copying data

      // Delete tasks
      let deleted = 0;
      for (const task of oldTasks) {
        const success = this.taskRepo.delete(task.id);
        if (success) {
          deleted++;
        }
      }

      logger.info(
        { deleted, cutoffDate: cutoffISO, retentionDays: this.config.taskRetentionDays },
        'Cleaned up old tasks',
      );

      return deleted;
    } catch (err) {
      logger.error({ err }, 'Error cleaning up old tasks');
      return 0;
    }
  }

  /**
   * Delete sessions for tasks that have been deleted
   */
  private async cleanupOrphanedSessions(): Promise<number> {
    try {
      // Get all sessions
      const allSessions = this.sessionRepo.findAll();
      const allTasks = new Set(this.taskRepo.findAll().map((t) => t.id));

      const orphaned = allSessions.filter((session) => !allTasks.has(session.taskId));

      if (orphaned.length === 0) {
        logger.debug('No orphaned sessions to clean up');
        return 0;
      }

      let deleted = 0;
      for (const session of orphaned) {
        const success = this.sessionRepo.delete(session.id);
        if (success) {
          deleted++;
        }
      }

      logger.info({ deleted }, 'Cleaned up orphaned sessions');
      return deleted;
    } catch (err) {
      logger.error({ err }, 'Error cleaning up orphaned sessions');
      return 0;
    }
  }

  /**
   * Delete audit logs older than retention period
   */
  private async cleanupOldAuditLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.auditLogRetentionDays);
    const cutoffISO = cutoffDate.toISOString();

    try {
      // Find old audit logs
      const oldLogs = this.auditLogRepo.findAll().filter((log) => log.timestamp < cutoffISO);

      if (oldLogs.length === 0) {
        logger.debug('No old audit logs to clean up');
        return 0;
      }

      let deleted = 0;
      for (const log of oldLogs) {
        const success = this.auditLogRepo.delete(log.id);
        if (success) {
          deleted++;
        }
      }

      logger.info(
        {
          deleted,
          cutoffDate: cutoffISO,
          retentionDays: this.config.auditLogRetentionDays,
        },
        'Cleaned up old audit logs',
      );

      return deleted;
    } catch (err) {
      logger.error({ err }, 'Error cleaning up old audit logs');
      return 0;
    }
  }

  /**
   * Delete offline queue entries older than retention period
   */
  private async cleanupOldOfflineQueue(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - this.config.offlineQueueRetentionHours);
    const cutoffMs = cutoffDate.getTime();

    try {
      // The OfflineQueueRepository already has a cleanExpired method
      // but we'll use a more explicit approach here for consistency
      const allEntries = this.offlineQueueRepo.findByAgentId(''); // Gets all
      const expired = allEntries.filter((entry) => {
        const createdMs = new Date(entry.createdAt).getTime();
        return createdMs < cutoffMs;
      });

      if (expired.length === 0) {
        logger.debug('No expired offline queue entries to clean up');
        return 0;
      }

      let deleted = 0;
      for (const entry of expired) {
        const success = this.offlineQueueRepo.delete(entry.id);
        if (success) {
          deleted++;
        }
      }

      logger.info(
        {
          deleted,
          cutoffDate: cutoffDate.toISOString(),
          retentionHours: this.config.offlineQueueRetentionHours,
        },
        'Cleaned up expired offline queue entries',
      );

      return deleted;
    } catch (err) {
      logger.error({ err }, 'Error cleaning up offline queue');
      return 0;
    }
  }

  /**
   * Get retention statistics without deleting
   */
  async getRetentionStats(): Promise<{
    oldTasks: number;
    orphanedSessions: number;
    oldAuditLogs: number;
    expiredOfflineQueue: number;
  }> {
    const taskCutoff = new Date();
    taskCutoff.setDate(taskCutoff.getDate() - this.config.taskRetentionDays);

    const auditCutoff = new Date();
    auditCutoff.setDate(auditCutoff.getDate() - this.config.auditLogRetentionDays);

    const queueCutoff = new Date();
    queueCutoff.setHours(queueCutoff.getHours() - this.config.offlineQueueRetentionHours);

    const oldTasks = this.taskRepo.findAll().filter((task) => {
      const isTerminal = ['completed', 'failed', 'cancelled'].includes(task.status);
      const isOld = task.createdAt < taskCutoff.toISOString();
      return isTerminal && isOld;
    }).length;

    const allSessions = this.sessionRepo.findAll();
    const allTasks = new Set(this.taskRepo.findAll().map((t) => t.id));
    const orphanedSessions = allSessions.filter((s) => !allTasks.has(s.taskId)).length;

    const oldAuditLogs = this.auditLogRepo
      .findAll()
      .filter((log) => log.timestamp < auditCutoff.toISOString()).length;

    const queueCutoffMs = queueCutoff.getTime();
    const allQueue = this.offlineQueueRepo.findByAgentId('');
    const expiredOfflineQueue = allQueue.filter(
      (e) => new Date(e.createdAt).getTime() < queueCutoffMs,
    ).length;

    return {
      oldTasks,
      orphanedSessions,
      oldAuditLogs,
      expiredOfflineQueue,
    };
  }
}
