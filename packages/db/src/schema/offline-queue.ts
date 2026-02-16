import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const offlineQueue = sqliteTable('offline_queue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  agentId: text('agent_id').notNull(),
  messageType: text('message_type').notNull(),
  payload: text('payload').notNull(), // JSON
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  expiresAt: text('expires_at').notNull(),
  delivered: integer('delivered', { mode: 'boolean' }).notNull().default(false),
  deliveredAt: text('delivered_at'),
});

export type OfflineQueueRow = typeof offlineQueue.$inferSelect;
export type OfflineQueueInsert = typeof offlineQueue.$inferInsert;
