import { eq, and, lt } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { pendingActions } from '../schema/pending-actions.js';
import type { PendingActionInsert, PendingActionRow } from '../schema/pending-actions.js';
import { classifySQLiteError } from '../errors.js';

const logger = {
  error: (data: any, msg?: string) => console.error(msg || 'Error:', data),
  info: (data: any, msg?: string) => console.log(msg || 'Info:', data),
  warn: (data: any, msg?: string) => console.warn(msg || 'Warn:', data),
};

export class PendingActionRepository extends BaseRepository {
  /**
   * Create a new pending action
   */
  create(data: PendingActionInsert): PendingActionRow {
    try {
      return this.db.insert(pendingActions).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to create pending action');
      throw classifySQLiteError(error, {
        operation: 'create',
        table: 'pending_actions',
        data,
      });
    }
  }

  /**
   * Find action by ID
   */
  findById(id: string): PendingActionRow | undefined {
    try {
      return this.db
        .select()
        .from(pendingActions)
        .where(eq(pendingActions.id, id))
        .get();
    } catch (error) {
      logger.error({ error, id }, 'Failed to find action by id');
      throw classifySQLiteError(error, {
        operation: 'findById',
        table: 'pending_actions',
        data: { id },
      });
    }
  }

  /**
   * Find pending actions by task ID
   */
  findByTaskId(taskId: string): PendingActionRow[] {
    try {
      return this.db
        .select()
        .from(pendingActions)
        .where(
          and(
            eq(pendingActions.taskId, taskId),
            eq(pendingActions.status, 'pending')
          )
        )
        .all();
    } catch (error) {
      logger.error({ error, taskId }, 'Failed to find actions by task id');
      throw classifySQLiteError(error, {
        operation: 'findByTaskId',
        table: 'pending_actions',
        data: { taskId },
      });
    }
  }

  /**
   * Mark action as completed
   */
  complete(id: string): void {
    try {
      this.db
        .update(pendingActions)
        .set({
          status: 'completed',
          completedAt: Date.now(),
        })
        .where(eq(pendingActions.id, id))
        .run();
    } catch (error) {
      logger.error({ error, id }, 'Failed to complete action');
      throw classifySQLiteError(error, {
        operation: 'complete',
        table: 'pending_actions',
        data: { id },
      });
    }
  }

  /**
   * Expire old pending actions
   */
  expireOldActions(): number {
    try {
      const now = Date.now();
      const result = this.db
        .update(pendingActions)
        .set({ status: 'expired' })
        .where(
          and(
            eq(pendingActions.status, 'pending'),
            lt(pendingActions.expiresAt, now)
          )
        )
        .run();

      return result.changes;
    } catch (error) {
      logger.error({ error }, 'Failed to expire old actions');
      throw classifySQLiteError(error, {
        operation: 'expireOldActions',
        table: 'pending_actions',
        data: {},
      });
    }
  }

  /**
   * Delete completed/expired actions older than X days
   */
  cleanup(olderThanMs: number): number {
    try {
      const cutoff = Date.now() - olderThanMs;
      const result = this.db
        .delete(pendingActions)
        .where(
          and(
            eq(pendingActions.status, 'completed'),
            lt(pendingActions.completedAt, cutoff)
          )
        )
        .run();

      return result.changes;
    } catch (error) {
      logger.error({ error, olderThanMs }, 'Failed to cleanup actions');
      throw classifySQLiteError(error, {
        operation: 'cleanup',
        table: 'pending_actions',
        data: { olderThanMs },
      });
    }
  }
}
