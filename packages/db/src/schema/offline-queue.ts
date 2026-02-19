import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Critical performance indexes:
// - agentQueue: Composite index for efficient queue processing (agentId + delivered status)
// - expiresAt: Fast cleanup operations for expired messages
export const offlineQueue = sqliteTable('offline_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  messageType: text('message_type').notNull(),
  payload: text('payload').notNull(), // JSON
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  expiresAt: text('expires_at').notNull(),
  delivered: integer('delivered', { mode: 'boolean' }).notNull().default(false),
  deliveredAt: text('delivered_at'),
}, (table) => ({
  agentQueueIdx: index('offline_queue_agent_delivered_idx').on(table.agentId, table.delivered),
  expiresAtIdx: index('offline_queue_expires_at_idx').on(table.expiresAt),
}));

export type OfflineQueueRow = typeof offlineQueue.$inferSelect;
export type OfflineQueueInsert = typeof offlineQueue.$inferInsert;
