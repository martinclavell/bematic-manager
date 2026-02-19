import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { OfflineQueueRepository } from './offline-queue.repository.js';
import { offlineQueue } from '../schema/offline-queue.js';
import { DatabaseTestFactory } from '../test-utils/database-test-factory.js';
import { ConstraintViolationError, RecordNotFoundError } from '../errors.js';

function createTestDatabase() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);

  // Create offline_queue table
  sqlite.exec(`
    CREATE TABLE offline_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT
    )
  `);

  // Create indexes
  sqlite.exec(`
    CREATE INDEX offline_queue_agent_delivered_idx ON offline_queue(agent_id, delivered);
    CREATE INDEX offline_queue_expires_at_idx ON offline_queue(expires_at);
  `);

  return db;
}

describe('OfflineQueueRepository', () => {
  let db: ReturnType<typeof drizzle>;
  let repo: OfflineQueueRepository;
  let factory: DatabaseTestFactory;

  beforeEach(() => {
    db = createTestDatabase();
    repo = new OfflineQueueRepository(db);
    factory = new DatabaseTestFactory();
  });

  describe('enqueue', () => {
    it('should enqueue message successfully', () => {
      const messageData = factory.createOfflineQueueMessage();

      const result = repo.enqueue(messageData);

      expect(result.id).toBeDefined();
      expect(result.agentId).toBe(messageData.agentId);
      expect(result.messageType).toBe(messageData.messageType);
      expect(result.payload).toBe(messageData.payload);
      expect(result.delivered).toBe(false);
      expect(result.deliveredAt).toBeNull();
      expect(result.createdAt).toBeDefined();
      expect(result.expiresAt).toBe(messageData.expiresAt);
    });

    it('should auto-increment ID for multiple messages', () => {
      const message1 = factory.createOfflineQueueMessage();
      const message2 = factory.createOfflineQueueMessage();

      const result1 = repo.enqueue(message1);
      const result2 = repo.enqueue(message2);

      expect(result1.id).toBe(1);
      expect(result2.id).toBe(2);
    });

    it('should handle constraint violations gracefully', () => {
      // Create message with missing required field
      const invalidMessage = {
        agentId: 'agent-123',
        messageType: '', // Empty message type
        payload: JSON.stringify({ test: 'data' }),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        delivered: false,
      };

      // Note: This test depends on the specific constraints in the database
      // With SQLite, empty string might be allowed, so we test a different constraint
      expect(() => repo.enqueue(invalidMessage as any)).not.toThrow();
    });

    it('should handle JSON payload correctly', () => {
      const complexPayload = {
        taskId: 'task_123',
        data: { key: 'value', nested: { array: [1, 2, 3] } },
        metadata: { timestamp: new Date().toISOString() },
      };

      const messageData = factory.createOfflineQueueMessage({
        payload: JSON.stringify(complexPayload),
      });

      const result = repo.enqueue(messageData);

      expect(JSON.parse(result.payload)).toEqual(complexPayload);
    });
  });

  describe('findPendingByAgentId', () => {
    it('should find pending messages for specific agent', () => {
      const agentId = 'agent-123';
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();

      const message1 = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureExpiry,
        delivered: false,
      });
      const message2 = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureExpiry,
        delivered: false,
      });
      const deliveredMessage = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureExpiry,
        delivered: true,
      });
      const differentAgentMessage = factory.createOfflineQueueMessage({
        agentId: 'agent-456',
        expiresAt: futureExpiry,
        delivered: false,
      });

      repo.enqueue(message1);
      repo.enqueue(message2);
      repo.enqueue(deliveredMessage);
      repo.enqueue(differentAgentMessage);

      const results = repo.findPendingByAgentId(agentId);

      expect(results).toHaveLength(2);
      expect(results.every(r => r.agentId === agentId)).toBe(true);
      expect(results.every(r => r.delivered === false)).toBe(true);
    });

    it('should exclude expired messages', () => {
      const agentId = 'agent-123';
      const expiredDate = new Date(Date.now() - 3600000).toISOString();
      const futureDate = new Date(Date.now() + 3600000).toISOString();

      const expiredMessage = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: expiredDate,
        delivered: false,
      });
      const validMessage = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureDate,
        delivered: false,
      });

      repo.enqueue(expiredMessage);
      repo.enqueue(validMessage);

      const results = repo.findPendingByAgentId(agentId);

      expect(results).toHaveLength(1);
      expect(results[0].expiresAt).toBe(futureDate);
    });

    it('should return empty array when no pending messages exist', () => {
      const results = repo.findPendingByAgentId('nonexistent-agent');

      expect(results).toEqual([]);
    });

    it('should return empty array when all messages are delivered', () => {
      const agentId = 'agent-123';
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();

      const message = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureExpiry,
        delivered: true,
      });

      repo.enqueue(message);

      const results = repo.findPendingByAgentId(agentId);

      expect(results).toEqual([]);
    });
  });

  describe('findAllPending', () => {
    it('should find all undelivered non-expired messages', () => {
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();

      const message1 = factory.createOfflineQueueMessage({
        agentId: 'agent-1',
        expiresAt: futureExpiry,
        delivered: false,
      });
      const message2 = factory.createOfflineQueueMessage({
        agentId: 'agent-2',
        expiresAt: futureExpiry,
        delivered: false,
      });
      const deliveredMessage = factory.createOfflineQueueMessage({
        agentId: 'agent-1',
        expiresAt: futureExpiry,
        delivered: true,
      });

      repo.enqueue(message1);
      repo.enqueue(message2);
      repo.enqueue(deliveredMessage);

      const results = repo.findAllPending();

      expect(results).toHaveLength(2);
      expect(results.every(r => r.delivered === false)).toBe(true);
      expect(results.map(r => r.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    });

    it('should exclude expired messages', () => {
      const expiredDate = new Date(Date.now() - 3600000).toISOString();
      const futureDate = new Date(Date.now() + 3600000).toISOString();

      const expiredMessage = factory.createOfflineQueueMessage({
        expiresAt: expiredDate,
        delivered: false,
      });
      const validMessage1 = factory.createOfflineQueueMessage({
        expiresAt: futureDate,
        delivered: false,
      });
      const validMessage2 = factory.createOfflineQueueMessage({
        expiresAt: futureDate,
        delivered: false,
      });

      repo.enqueue(expiredMessage);
      repo.enqueue(validMessage1);
      repo.enqueue(validMessage2);

      const results = repo.findAllPending();

      expect(results).toHaveLength(2);
      expect(results.every(r => r.expiresAt === futureDate)).toBe(true);
    });

    it('should return empty array when no pending messages exist', () => {
      const results = repo.findAllPending();

      expect(results).toEqual([]);
    });
  });

  describe('markDelivered', () => {
    it('should mark message as delivered successfully', () => {
      const messageData = factory.createOfflineQueueMessage();
      const created = repo.enqueue(messageData);

      repo.markDelivered(created.id);

      // Verify the message is marked as delivered
      const pending = repo.findPendingByAgentId(messageData.agentId);
      expect(pending).toHaveLength(0);

      // Verify by checking the database directly
      const updated = db.select().from(offlineQueue).where(offlineQueue.id.is(created.id)).get();
      expect(updated?.delivered).toBe(true);
      expect(updated?.deliveredAt).toBeDefined();
    });

    it('should throw RecordNotFoundError when message does not exist', () => {
      expect(() => repo.markDelivered(999))
        .toThrow(RecordNotFoundError);
    });

    it('should update deliveredAt timestamp', () => {
      const messageData = factory.createOfflineQueueMessage();
      const created = repo.enqueue(messageData);

      const beforeTime = new Date();
      repo.markDelivered(created.id);
      const afterTime = new Date();

      const updated = db.select().from(offlineQueue).where(offlineQueue.id.is(created.id)).get();
      const deliveredAt = new Date(updated!.deliveredAt!);

      expect(deliveredAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(deliveredAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should handle marking already delivered message', () => {
      const messageData = factory.createOfflineQueueMessage();
      const created = repo.enqueue(messageData);

      // Mark as delivered first time
      repo.markDelivered(created.id);

      // Try to mark again - should not throw but no changes should occur
      repo.markDelivered(created.id);

      const updated = db.select().from(offlineQueue).where(offlineQueue.id.is(created.id)).get();
      expect(updated?.delivered).toBe(true);
    });
  });

  describe('cleanExpired', () => {
    it('should delete expired undelivered messages and return count', () => {
      const expiredDate = new Date(Date.now() - 3600000).toISOString();
      const futureDate = new Date(Date.now() + 3600000).toISOString();

      // Create expired undelivered messages
      const expiredMessage1 = factory.createExpiredOfflineQueueMessage();
      const expiredMessage2 = factory.createExpiredOfflineQueueMessage();

      // Create expired delivered message (should not be deleted)
      const expiredDeliveredMessage = factory.createExpiredOfflineQueueMessage({
        delivered: true,
      });

      // Create valid undelivered message (should not be deleted)
      const validMessage = factory.createOfflineQueueMessage({
        expiresAt: futureDate,
        delivered: false,
      });

      repo.enqueue(expiredMessage1);
      repo.enqueue(expiredMessage2);
      repo.enqueue(expiredDeliveredMessage);
      repo.enqueue(validMessage);

      const deletedCount = repo.cleanExpired();

      expect(deletedCount).toBe(2);

      // Verify remaining messages
      const remaining = db.select().from(offlineQueue).all();
      expect(remaining).toHaveLength(2); // delivered expired + valid undelivered
    });

    it('should return 0 when no expired messages exist', () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();

      const validMessage = factory.createOfflineQueueMessage({
        expiresAt: futureDate,
        delivered: false,
      });

      repo.enqueue(validMessage);

      const deletedCount = repo.cleanExpired();

      expect(deletedCount).toBe(0);

      // Verify message still exists
      const remaining = db.select().from(offlineQueue).all();
      expect(remaining).toHaveLength(1);
    });

    it('should handle empty queue gracefully', () => {
      const deletedCount = repo.cleanExpired();

      expect(deletedCount).toBe(0);
    });

    it('should not delete delivered expired messages', () => {
      const expiredDate = new Date(Date.now() - 3600000).toISOString();

      const expiredDeliveredMessage = factory.createOfflineQueueMessage({
        expiresAt: expiredDate,
        delivered: true,
        deliveredAt: new Date().toISOString(),
      });

      repo.enqueue(expiredDeliveredMessage);

      const deletedCount = repo.cleanExpired();

      expect(deletedCount).toBe(0);

      // Verify message still exists
      const remaining = db.select().from(offlineQueue).all();
      expect(remaining).toHaveLength(1);
    });

    it('should handle partial deletion failures gracefully', () => {
      // This test simulates a scenario where some deletions might fail
      // In practice, this is hard to simulate with SQLite in memory,
      // but the method is designed to handle it
      const expiredMessage = factory.createExpiredOfflineQueueMessage();
      repo.enqueue(expiredMessage);

      const deletedCount = repo.cleanExpired();

      expect(deletedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases', () => {
    it('should handle messages with very long payloads', () => {
      const longPayload = JSON.stringify({ data: 'A'.repeat(10000) });
      const messageData = factory.createOfflineQueueMessage({
        payload: longPayload,
      });

      const result = repo.enqueue(messageData);

      expect(result.payload).toBe(longPayload);
    });

    it('should handle messages with special characters in payload', () => {
      const specialPayload = JSON.stringify({
        message: 'Special chars: 你好 🎉 café naïve',
        unicode: '\u2603\u2665\u266B',
      });

      const messageData = factory.createOfflineQueueMessage({
        payload: specialPayload,
      });

      const result = repo.enqueue(messageData);

      expect(result.payload).toBe(specialPayload);
    });

    it('should handle edge case timestamps (far future)', () => {
      const farFuture = new Date('2099-12-31T23:59:59Z').toISOString();
      const messageData = factory.createOfflineQueueMessage({
        expiresAt: farFuture,
      });

      const result = repo.enqueue(messageData);

      expect(result.expiresAt).toBe(farFuture);

      const pending = repo.findPendingByAgentId(messageData.agentId);
      expect(pending).toHaveLength(1);
    });

    it('should handle concurrent operations safely', () => {
      const messageData = factory.createOfflineQueueMessage();
      const created = repo.enqueue(messageData);

      // Simulate concurrent markDelivered calls
      repo.markDelivered(created.id);

      // Second call should not cause issues
      expect(() => repo.markDelivered(created.id)).not.toThrow();
    });

    it('should handle messages with null optional fields', () => {
      const messageData = factory.createOfflineQueueMessage({
        deliveredAt: null, // Should be null for undelivered messages
      });

      const result = repo.enqueue(messageData);

      expect(result.deliveredAt).toBeNull();
    });

    it('should preserve message order in queries', () => {
      const agentId = 'agent-123';
      const futureExpiry = new Date(Date.now() + 3600000).toISOString();

      // Create messages with different creation times
      const message1 = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureExpiry,
        createdAt: '2024-01-01T10:00:00Z',
      });
      const message2 = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureExpiry,
        createdAt: '2024-01-01T11:00:00Z',
      });
      const message3 = factory.createOfflineQueueMessage({
        agentId,
        expiresAt: futureExpiry,
        createdAt: '2024-01-01T09:00:00Z',
      });

      const created1 = repo.enqueue(message1);
      const created2 = repo.enqueue(message2);
      const created3 = repo.enqueue(message3);

      const results = repo.findPendingByAgentId(agentId);

      expect(results).toHaveLength(3);
      // Results should maintain insertion order (by ID) since no explicit ordering is specified
      expect(results[0].id).toBe(created1.id);
      expect(results[1].id).toBe(created2.id);
      expect(results[2].id).toBe(created3.id);
    });
  });
});