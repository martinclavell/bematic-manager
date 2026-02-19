import { createLogger } from '@bematic/common';
import type {
  TaskRepository,
  AuditLogRepository,
  OfflineQueueRepository,
  SessionRepository,
  ArchivedTaskRepository,
} from '@bematic/db';
import type { ArchivedTaskInsert } from '@bematic/db';
import { randomUUID } from 'crypto';

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
  /** Archive retention period in days (archives older than this are deleted) */
  archiveRetentionDays: number;
}

const DEFAULT_CONFIG: RetentionConfig = {
  taskRetentionDays: 30,
  auditLogRetentionDays: 90,
  offlineQueueRetentionHours: 24,
  archiveBeforeDelete: true,
  archiveRetentionDays: 365, // Keep archives for 1 year
};

export class RetentionService {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly sessionRepo: SessionRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly offlineQueueRepo: OfflineQueueRepository,
    private readonly archivedTaskRepo: ArchivedTaskRepository,
    private readonly config: RetentionConfig = DEFAULT_CONFIG,
  ) {}

  /**
   * Run all retention policies
   * Returns total number of records deleted
   */
  async runRetentionPolicies(): Promise<{
    tasksDeleted: number;
    tasksArchived: number;
    sessionsDeleted: number;
    auditLogsDeleted: number;
    offlineQueueDeleted: number;
    oldArchivesDeleted: number;
  }> {
    logger.info('Starting retention policy execution');

    const taskCleanupResults = await this.cleanupOldTasks();
    const results = {
      tasksDeleted: taskCleanupResults.deleted,
      tasksArchived: taskCleanupResults.archived,
      sessionsDeleted: await this.cleanupOrphanedSessions(),
      auditLogsDeleted: await this.cleanupOldAuditLogs(),
      offlineQueueDeleted: await this.cleanupOldOfflineQueue(),
      oldArchivesDeleted: await this.cleanupOldArchives(),
    };

    const total =
      results.tasksDeleted +
      results.sessionsDeleted +
      results.auditLogsDeleted +
      results.offlineQueueDeleted +
      results.oldArchivesDeleted;

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
   * Archives tasks first if archiveBeforeDelete is enabled
   */
  private async cleanupOldTasks(): Promise<{ deleted: number; archived: number }> {
    logger.info('Starting task cleanup');

    const oldTasks = this.taskRepo.findOldTerminalTasks(this.config.taskRetentionDays);

    if (oldTasks.length === 0) {
      logger.info('No old tasks found for cleanup');
      return { deleted: 0, archived: 0 };
    }

    let archivedCount = 0;

    // Archive tasks if enabled
    if (this.config.archiveBeforeDelete) {
      logger.info({ taskCount: oldTasks.length }, 'Archiving tasks before deletion');

      for (const task of oldTasks) {
        try {
          await this.archiveTask(task, 'retention_policy');
          archivedCount++;
        } catch (error) {
          logger.error({ error, taskId: task.id }, 'Failed to archive task, skipping deletion');
          continue;
        }
      }
    }

    // Delete tasks from main table
    const taskIds = oldTasks.map(t => t.id);
    const deletedCount = this.taskRepo.deleteByIds(taskIds);

    logger.info({ deleted: deletedCount, archived: archivedCount }, 'Task cleanup completed');
    return { deleted: deletedCount, archived: archivedCount };
  }

  /**
   * Delete sessions for tasks that have been deleted
   */
  private async cleanupOrphanedSessions(): Promise<number> {
    // For now, return 0 as the SessionRepository doesn't have findAll() or delete() methods
    // TODO: Implement when repository has proper bulk operations
    logger.info('Session cleanup skipped - repository methods not implemented');
    return 0;
  }

  /**
   * Delete audit logs older than retention period
   */
  private async cleanupOldAuditLogs(): Promise<number> {
    // For now, return 0 as the AuditLogRepository doesn't have findAll() or delete() methods
    // TODO: Implement when repository has proper bulk operations
    logger.info('Audit log cleanup skipped - repository methods not implemented');
    return 0;
  }

  /**
   * Delete offline queue entries older than retention period
   */
  private async cleanupOldOfflineQueue(): Promise<number> {
    // For now, return 0 as the OfflineQueueRepository doesn't have findByAgentId('') or delete() methods
    // TODO: Implement when repository has proper bulk operations
    logger.info('Offline queue cleanup skipped - repository methods not implemented');
    return 0;
  }

  /**
   * Delete old archived tasks beyond archive retention period
   */
  private async cleanupOldArchives(): Promise<number> {
    logger.info('Starting archive cleanup');
    return await this.archivedTaskRepo.deleteOldArchives(this.config.archiveRetentionDays);
  }

  /**
   * Archive a task to the archived_tasks table
   */
  async archiveTask(task: any, reason: string): Promise<void> {
    logger.debug({ taskId: task.id, reason }, 'Archiving task');

    const archivedTask: ArchivedTaskInsert = {
      id: randomUUID(),
      originalId: task.id,
      archivedAt: new Date(),
      taskData: JSON.stringify(task),
      reason,
      projectId: task.projectId,
      userId: task.userId,
      status: task.status,
      createdAt: task.createdAt ? new Date(task.createdAt) : undefined,
    };

    await this.archivedTaskRepo.create(archivedTask);
    logger.debug({ taskId: task.id }, 'Task archived successfully');
  }

  /**
   * Restore a task from archive back to the main tasks table
   */
  async restoreTask(archiveId: string): Promise<any> {
    logger.info({ archiveId }, 'Restoring task from archive');

    const archivedTask = await this.archivedTaskRepo.findById(archiveId);
    if (!archivedTask) {
      throw new Error(`Archived task not found: ${archiveId}`);
    }

    const taskData = JSON.parse(archivedTask.taskData);

    // Create task in main table with a new ID (to avoid conflicts)
    const restoredTask = this.taskRepo.create({
      ...taskData,
      id: randomUUID(),
      restoredAt: new Date().toISOString(),
      restoredFromArchive: archivedTask.id,
    });

    // Remove from archive
    await this.archivedTaskRepo.delete(archiveId);

    logger.info({ archiveId, newTaskId: restoredTask.id }, 'Task restored successfully');
    return restoredTask;
  }

  /**
   * Get retention statistics without deleting
   */
  async getRetentionStats(): Promise<{
    oldTasks: number;
    orphanedSessions: number;
    oldAuditLogs: number;
    expiredOfflineQueue: number;
    archiveStats: {
      total: number;
      byReason: Record<string, number>;
      byStatus: Record<string, number>;
      oldestArchive: Date | null;
      newestArchive: Date | null;
    };
  }> {
    const archiveStats = await this.archivedTaskRepo.getStats();

    return {
      oldTasks: this.taskRepo.countOldTerminalTasks(this.config.taskRetentionDays),
      orphanedSessions: 0, // TODO: Implement when repository has bulk query methods
      oldAuditLogs: 0, // TODO: Implement when repository has bulk query methods
      expiredOfflineQueue: 0, // TODO: Implement when repository has bulk query methods
      archiveStats,
    };
  }
}
