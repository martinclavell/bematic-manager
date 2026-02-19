import { eq, and, desc, isNotNull, sql, lt } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { tasks } from '../schema/tasks.js';
import type { TaskInsert, TaskRow } from '../schema/tasks.js';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

// Simple logger for testing
const logger = {
  error: (data: any, msg?: string) => console.error(msg || 'Error:', data),
  info: (data: any, msg?: string) => console.log(msg || 'Info:', data),
  warn: (data: any, msg?: string) => console.warn(msg || 'Warn:', data),
};

export class TaskRepository extends BaseRepository {
  create(data: TaskInsert): TaskRow {
    try {
      return this.db.insert(tasks).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create task');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'tasks',
        data,
      });
    }
  }

  findById(id: string): TaskRow | undefined {
    try {
      return this.db.select().from(tasks).where(eq(tasks.id, id)).get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find task by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'tasks',
        data: { id },
      });
    }
  }

  findByProjectId(projectId: string, limit = 50): TaskRow[] {
    try {
      return this.db
        .select()
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .orderBy(desc(tasks.createdAt))
        .limit(limit)
        .all();
    } catch (error) {
      logger.error({ error, projectId, limit }, 'Failed to find tasks by project id');
      throw classifySQLiteError(error, {
        operation: 'findByProjectId',
        table: 'tasks',
        data: { projectId, limit },
      });
    }
  }

  findByStatus(status: string): TaskRow[] {
    try {
      return this.db
        .select()
        .from(tasks)
        .where(eq(tasks.status, status))
        .all();
    } catch (error) {
      logger.error({ error, status }, 'Failed to find tasks by status');
      throw classifySQLiteError(error, {
        operation: 'findByStatus',
        table: 'tasks',
        data: { status },
      });
    }
  }

  findActiveByProjectId(projectId: string): TaskRow[] {
    try {
      return this.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, projectId),
            eq(tasks.status, 'running'),
          ),
        )
        .all();
    } catch (error) {
      logger.error({ error, projectId }, 'Failed to find active tasks by project id');
      throw classifySQLiteError(error, {
        operation: 'findActiveByProjectId',
        table: 'tasks',
        data: { projectId },
      });
    }
  }

  update(id: string, data: Partial<TaskInsert>): TaskRow | undefined {
    try {
      const result = this.db
        .update(tasks)
        .set({ ...data, updatedAt: new Date().toISOString() })
        .where(eq(tasks.id, id))
        .returning()
        .get();

      if (!result) {
        throw new RecordNotFoundError('tasks', id, {
          operation: 'update',
          data,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, data }, 'Failed to update task');
      throw classifySQLiteError(error, {
        operation: 'update',
        table: 'tasks',
        data: { id, ...data },
      });
    }
  }

  complete(
    id: string,
    result: string,
    metrics: {
      inputTokens: number;
      outputTokens: number;
      estimatedCost: number;
      filesChanged: string[];
      commandsRun: string[];
    },
  ): TaskRow | undefined {
    try {
      const updateData = {
        status: 'completed',
        result,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        estimatedCost: metrics.estimatedCost,
        filesChanged: JSON.stringify(metrics.filesChanged),
        commandsRun: JSON.stringify(metrics.commandsRun),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      const completedTask = this.db
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, id))
        .returning()
        .get();

      if (!completedTask) {
        throw new RecordNotFoundError('tasks', id, {
          operation: 'complete',
          data: { result, metrics },
        });
      }

      return completedTask;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, result, metrics }, 'Failed to complete task');
      throw classifySQLiteError(error, {
        operation: 'complete',
        table: 'tasks',
        data: { id, result, metrics },
      });
    }
  }

  /** Find the most recent task in a Slack thread that has a session ID (any status) */
  findLastSessionInThread(channelId: string, threadTs: string): TaskRow | undefined {
    try {
      return this.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.slackChannelId, channelId),
            eq(tasks.slackThreadTs, threadTs),
            isNotNull(tasks.sessionId),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(1)
        .get();
    } catch (error) {
      logger.error({ error, channelId, threadTs }, 'Failed to find last session in thread');
      throw classifySQLiteError(error, {
        operation: 'findLastSessionInThread',
        table: 'tasks',
        data: { channelId, threadTs },
      });
    }
  }

  fail(id: string, errorMessage: string): TaskRow | undefined {
    try {
      const failedTask = this.db
        .update(tasks)
        .set({
          status: 'failed',
          errorMessage,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        })
        .where(eq(tasks.id, id))
        .returning()
        .get();

      if (!failedTask) {
        throw new RecordNotFoundError('tasks', id, {
          operation: 'fail',
          data: { errorMessage },
        });
      }

      return failedTask;
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id, errorMessage }, 'Failed to mark task as failed');
      throw classifySQLiteError(error, {
        operation: 'fail',
        table: 'tasks',
        data: { id, errorMessage },
      });
    }
  }

  /** Find all subtasks of a parent task */
  findByParentTaskId(parentTaskId: string): TaskRow[] {
    try {
      return this.db
        .select()
        .from(tasks)
        .where(eq(tasks.parentTaskId, parentTaskId))
        .orderBy(tasks.createdAt)
        .all();
    } catch (error) {
      logger.error({ error, parentTaskId }, 'Failed to find subtasks by parent task id');
      throw classifySQLiteError(error, {
        operation: 'findByParentTaskId',
        table: 'tasks',
        data: { parentTaskId },
      });
    }
  }

  /** Check if all subtasks of a parent are in a terminal state */
  areAllSubtasksComplete(parentTaskId: string): boolean {
    try {
      const subtasks = this.findByParentTaskId(parentTaskId);
      if (subtasks.length === 0) return false;
      return subtasks.every(
        (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled',
      );
    } catch (error) {
      logger.error({ error, parentTaskId }, 'Failed to check if all subtasks are complete');
      throw classifySQLiteError(error, {
        operation: 'areAllSubtasksComplete',
        table: 'tasks',
        data: { parentTaskId },
      });
    }
  }

  /** Find tasks older than specified days with terminal status */
  findOldTerminalTasks(retentionDays: number): TaskRow[] {
    try {
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const cutoffDateString = cutoffDate.toISOString();

      return this.db
        .select()
        .from(tasks)
        .where(
          and(
            sql`${tasks.updatedAt} < ${cutoffDateString}`,
            sql`${tasks.status} IN ('completed', 'failed', 'cancelled')`
          )
        )
        .all();
    } catch (error) {
      logger.error({ error, retentionDays }, 'Failed to find old terminal tasks');
      throw classifySQLiteError(error, {
        operation: 'findOldTerminalTasks',
        table: 'tasks',
        data: { retentionDays },
      });
    }
  }

  /** Delete tasks by IDs (for cleanup after archiving) */
  deleteByIds(taskIds: string[]): number {
    try {
      if (taskIds.length === 0) return 0;

      const result = this.db
        .delete(tasks)
        .where(sql`${tasks.id} IN (${taskIds.map(() => '?').join(',')})`)
        .run();

      return result.changes;
    } catch (error) {
      logger.error({ error, taskIds }, 'Failed to delete tasks by IDs');
      throw classifySQLiteError(error, {
        operation: 'deleteByIds',
        table: 'tasks',
        data: { taskIds },
      });
    }
  }

  /** Get count of old terminal tasks without fetching them */
  countOldTerminalTasks(retentionDays: number): number {
    try {
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const cutoffDateString = cutoffDate.toISOString();

      const [result] = this.db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(
          and(
            sql`${tasks.updatedAt} < ${cutoffDateString}`,
            sql`${tasks.status} IN ('completed', 'failed', 'cancelled')`
          )
        )
        .all();

      return result.count;
    } catch (error) {
      logger.error({ error, retentionDays }, 'Failed to count old terminal tasks');
      throw classifySQLiteError(error, {
        operation: 'countOldTerminalTasks',
        table: 'tasks',
        data: { retentionDays },
      });
    }
  }
}
