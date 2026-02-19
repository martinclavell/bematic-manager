import { eq, and, lte } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { offlineQueue } from '../schema/offline-queue.js';
import type { OfflineQueueInsert, OfflineQueueRow } from '../schema/offline-queue.js';
import { classifySQLiteError, RecordNotFoundError } from '../errors.js';

// Simple logger for testing
const logger = {
  error: (data: any, msg?: string) => console.error(msg || 'Error:', data),
  info: (data: any, msg?: string) => console.log(msg || 'Info:', data),
  warn: (data: any, msg?: string) => console.warn(msg || 'Warn:', data),
};

export class OfflineQueueRepository extends BaseRepository {
  enqueue(data: OfflineQueueInsert): OfflineQueueRow {
    try {
      return this.db.insert(offlineQueue).values(data).returning().get();
    } catch (error) {
      logger.error({ error, data }, 'Failed to enqueue offline message');
      throw classifySQLiteError(error, {
        operation: 'enqueue',
        table: 'offline_queue',
        data,
      });
    }
  }

  findPendingByAgentId(agentId: string): OfflineQueueRow[] {
    try {
      const now = new Date().toISOString();
      return this.db
        .select()
        .from(offlineQueue)
        .where(
          and(
            eq(offlineQueue.agentId, agentId),
            eq(offlineQueue.delivered, false),
          ),
        )
        .all()
        .filter((row) => row.expiresAt > now);
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to find pending messages by agent id');
      throw classifySQLiteError(error, {
        operation: 'findPendingByAgentId',
        table: 'offline_queue',
        data: { agentId },
      });
    }
  }

  /** Find ALL undelivered, non-expired entries regardless of agentId */
  findAllPending(): OfflineQueueRow[] {
    try {
      const now = new Date().toISOString();
      return this.db
        .select()
        .from(offlineQueue)
        .where(eq(offlineQueue.delivered, false))
        .all()
        .filter((row) => row.expiresAt > now);
    } catch (error) {
      logger.error({ error }, 'Failed to find all pending messages');
      throw classifySQLiteError(error, {
        operation: 'findAllPending',
        table: 'offline_queue',
      });
    }
  }

  markDelivered(id: number): void {
    try {
      const result = this.db
        .update(offlineQueue)
        .set({
          delivered: true,
          deliveredAt: new Date().toISOString(),
        })
        .where(eq(offlineQueue.id, id))
        .run();

      if (result.changes === 0) {
        throw new RecordNotFoundError('offline_queue', id, {
          operation: 'markDelivered',
        });
      }
    } catch (error) {
      if (error instanceof RecordNotFoundError) {
        throw error;
      }
      logger.error({ error, id }, 'Failed to mark message as delivered');
      throw classifySQLiteError(error, {
        operation: 'markDelivered',
        table: 'offline_queue',
        data: { id },
      });
    }
  }

  cleanExpired(): number {
    try {
      const now = new Date().toISOString();
      const expired = this.db
        .select()
        .from(offlineQueue)
        .where(
          and(
            eq(offlineQueue.delivered, false),
            lte(offlineQueue.expiresAt, now),
          ),
        )
        .all();

      let deletedCount = 0;
      for (const row of expired) {
        try {
          const result = this.db.delete(offlineQueue).where(eq(offlineQueue.id, row.id)).run();
          if (result.changes > 0) {
            deletedCount++;
          }
        } catch (deleteError) {
          logger.warn({ error: deleteError, rowId: row.id }, 'Failed to delete expired message');
          // Continue with other rows instead of failing the entire operation
        }
      }

      if (deletedCount > 0) {
        logger.info({ deletedCount }, 'Cleaned expired offline messages');
      }

      return deletedCount;
    } catch (error) {
      logger.error({ error }, 'Failed to clean expired messages');
      throw classifySQLiteError(error, {
        operation: 'cleanExpired',
        table: 'offline_queue',
      });
    }
  }
}
