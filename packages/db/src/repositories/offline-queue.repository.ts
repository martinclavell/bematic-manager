import { eq, and, lte } from 'drizzle-orm';
import { BaseRepository } from './base.repository.js';
import { offlineQueue } from '../schema/offline-queue.js';
import type { OfflineQueueInsert, OfflineQueueRow } from '../schema/offline-queue.js';

export class OfflineQueueRepository extends BaseRepository {
  enqueue(data: OfflineQueueInsert): OfflineQueueRow {
    return this.db.insert(offlineQueue).values(data).returning().get();
  }

  findPendingByAgentId(agentId: string): OfflineQueueRow[] {
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
      .filter((row) => row.expiresAt > now); // Filter out expired
  }

  markDelivered(id: number): void {
    this.db
      .update(offlineQueue)
      .set({
        delivered: true,
        deliveredAt: new Date().toISOString(),
      })
      .where(eq(offlineQueue.id, id))
      .run();
  }

  cleanExpired(): number {
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

    for (const row of expired) {
      this.db.delete(offlineQueue).where(eq(offlineQueue.id, row.id)).run();
    }

    return expired.length;
  }
}
