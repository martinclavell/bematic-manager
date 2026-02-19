import { eq, and, desc, sql, lte } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { scheduledTasks } from '../schema/scheduled-tasks.js';
import type { ScheduledTaskInsert, ScheduledTaskRow } from '../schema/scheduled-tasks.js';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

// Simple logger for testing
const logger = {
  error: (data: any, msg?: string) => console.error(msg || 'Error:', data),
  info: (data: any, msg?: string) => console.log(msg || 'Info:', data),
  warn: (data: any, msg?: string) => console.warn(msg || 'Warn:', data),
};

export class ScheduledTaskRepository extends BaseRepository {
  create(data: ScheduledTaskInsert): ScheduledTaskRow {
    try {
      return this.db.insert(scheduledTasks).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create scheduled task');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'scheduled_tasks',
        data,
      });
    }
  }

  findById(id: string): ScheduledTaskRow | undefined {
    try {
      return this.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find scheduled task by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'scheduled_tasks',
        data: { id },
      });
    }
  }

  findByProjectId(projectId: string): ScheduledTaskRow[] {
    try {
      return this.db
        .select()
        .from(scheduledTasks)
        .where(eq(scheduledTasks.projectId, projectId))
        .orderBy(desc(scheduledTasks.createdAt))
        .all();
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to find scheduled tasks by project id');
      throw classifySQLiteError(error, {
        operation: 'findByProjectId',
        table: 'scheduled_tasks',
        data: { projectId },
      });
    }
  }

  findByUserId(userId: string): ScheduledTaskRow[] {
    try {
      return this.db
        .select()
        .from(scheduledTasks)
        .where(eq(scheduledTasks.userId, userId))
        .orderBy(desc(scheduledTasks.createdAt))
        .all();
    } catch (error) {
      logger.error({ error, userId }, 'Failed to find scheduled tasks by user id');
      throw classifySQLiteError(error, {
        operation: 'findByUserId',
        table: 'scheduled_tasks',
        data: { userId },
      });
    }
  }

  findByStatus(status: string): ScheduledTaskRow[] {
    try {
      return this.db
        .select()
        .from(scheduledTasks)
        .where(eq(scheduledTasks.status, status))
        .all();
    } catch (error) {
      logger.error({ error, status }, 'Failed to find scheduled tasks by status');
      throw classifySQLiteError(error, {
        operation: 'findByStatus',
        table: 'scheduled_tasks',
        data: { status },
      });
    }
  }

  /**
   * Find all scheduled tasks that are due for execution
   * WHERE nextExecutionAt <= NOW() AND enabled = true AND status IN ('pending', 'active')
   */
  findDue(): ScheduledTaskRow[] {
    try {
      const now = new Date().toISOString();
      return this.db
        .select()
        .from(scheduledTasks)
        .where(
          and(
            lte(scheduledTasks.nextExecutionAt, now),
            eq(scheduledTasks.enabled, true),
            sql`${scheduledTasks.status} IN ('pending', 'active')`,
          ),
        )
        .orderBy(scheduledTasks.nextExecutionAt)
        .all();
    } catch (error) {
      logger.error({ error }, 'Failed to find due scheduled tasks');
      throw classifySQLiteError(error, {
        operation: 'findDue',
        table: 'scheduled_tasks',
      });
    }
  }

  /**
   * Get upcoming scheduled tasks within the next N hours
   */
  getUpcoming(hours: number): ScheduledTaskRow[] {
    try {
      const now = new Date();
      const future = new Date(now.getTime() + hours * 60 * 60 * 1000);

      return this.db
        .select()
        .from(scheduledTasks)
        .where(
          and(
            sql`${scheduledTasks.nextExecutionAt} >= ${now.toISOString()}`,
            sql`${scheduledTasks.nextExecutionAt} <= ${future.toISOString()}`,
            eq(scheduledTasks.enabled, true),
            sql`${scheduledTasks.status} IN ('pending', 'active')`,
          ),
        )
        .orderBy(scheduledTasks.nextExecutionAt)
        .all();
    } catch (error) {
      logger.error({ error, hours }, 'Failed to get upcoming scheduled tasks');
      throw classifySQLiteError(error, {
        operation: 'getUpcoming',
        table: 'scheduled_tasks',
        data: { hours },
      });
    }
  }

  update(id: string, data: Partial<ScheduledTaskInsert>): ScheduledTaskRow | undefined {
    try {
      const result = this.db
        .update(scheduledTasks)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(scheduledTasks.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('scheduled_tasks', id, {
          operation: 'update',
          data,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, data }, 'Failed to update scheduled task');
      throw classifySQLiteError(error, {
        operation: 'update',
        table: 'scheduled_tasks',
        data: { id, ...data },
      });
    }
  }

  delete(id: string): void {
    try {
      const result = this.db
        .delete(scheduledTasks)
        .where(eq(scheduledTasks.id, id))
        .run();

      if (result.changes === 0) {
        throw new RecordNotFoundError('scheduled_tasks', id, {
          operation: 'delete',
        });
      }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to delete scheduled task');
      throw classifySQLiteError(error, {
        operation: 'delete',
        table: 'scheduled_tasks',
        data: { id },
      });
    }
  }

  /**
   * Get statistics about scheduled tasks by status
   */
  countByStatus(): Record<string, number> {
    try {
      const results = this.db
        .select({
          status: scheduledTasks.status,
          count: sql<number>`count(*)`,
        })
        .from(scheduledTasks)
        .groupBy(scheduledTasks.status)
        .all();

      return results.reduce((acc, row) => {
        acc[row.status] = row.count;
        return acc;
      }, {} as Record<string, number>);
    } catch (error) {
      logger.error({ error }, 'Failed to count scheduled tasks by status');
      throw classifySQLiteError(error, {
        operation: 'countByStatus',
        table: 'scheduled_tasks',
      });
    }
  }

  /**
   * Find all scheduled tasks (with optional filters)
   */
  findAll(filters?: {
    projectId?: string;
    userId?: string;
    status?: string;
    enabled?: boolean;
  }): ScheduledTaskRow[] {
    try {
      const conditions = [];
      if (filters?.projectId) {
        conditions.push(eq(scheduledTasks.projectId, filters.projectId));
      }
      if (filters?.userId) {
        conditions.push(eq(scheduledTasks.userId, filters.userId));
      }
      if (filters?.status) {
        conditions.push(eq(scheduledTasks.status, filters.status));
      }
      if (filters?.enabled !== undefined) {
        conditions.push(eq(scheduledTasks.enabled, filters.enabled));
      }

      if (conditions.length > 0) {
        return this.db
          .select()
          .from(scheduledTasks)
          .where(and(...conditions))
          .orderBy(desc(scheduledTasks.createdAt))
          .all();
      }

      return this.db
        .select()
        .from(scheduledTasks)
        .orderBy(desc(scheduledTasks.createdAt))
        .all();
    } catch (error) {
      logger.error({ error, filters }, 'Failed to find all scheduled tasks');
      throw classifySQLiteError(error, {
        operation: 'findAll',
        table: 'scheduled_tasks',
        data: filters,
      });
    }
  }

  /**
   * Delete old completed/cancelled scheduled tasks
   */
  deleteOldCompleted(retentionDays: number): number {
    try {
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const cutoffDateString = cutoffDate.toISOString();

      const result = this.db
        .delete(scheduledTasks)
        .where(
          and(
            sql`${scheduledTasks.updatedAt} < ${cutoffDateString}`,
            sql`${scheduledTasks.status} IN ('completed', 'cancelled', 'failed')`,
          ),
        )
        .run();

      return result.changes;
    } catch (error) {
      logger.error({ error, retentionDays }, 'Failed to delete old completed scheduled tasks');
      throw classifySQLiteError(error, {
        operation: 'deleteOldCompleted',
        table: 'scheduled_tasks',
        data: { retentionDays },
      });
    }
  }

  /**
   * Count scheduled tasks by user (for quota enforcement)
   */
  countByUser(userId: string): number {
    try {
      const [result] = this.db
        .select({ count: sql<number>`count(*)` })
        .from(scheduledTasks)
        .where(
          and(
            eq(scheduledTasks.userId, userId),
            sql`${scheduledTasks.status} IN ('pending', 'active', 'paused')`,
          ),
        )
        .all();

      return result.count;
    } catch (error) {
      logger.error({ error, userId }, 'Failed to count scheduled tasks by user');
      throw classifySQLiteError(error, {
        operation: 'countByUser',
        table: 'scheduled_tasks',
        data: { userId },
      });
    }
  }
}
