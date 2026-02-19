import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Tracks pending interactive actions (buttons) that users can click
 * Used for plan approvals, confirmations, feedback collection, etc.
 */
export const pendingActions = sqliteTable('pending_actions', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // ActionType enum
  taskId: text('task_id'), // Optional: related task
  userId: text('user_id').notNull(),
  channelId: text('channel_id').notNull(),
  threadTs: text('thread_ts'),
  messageTs: text('message_ts'), // Message containing the buttons
  metadata: text('metadata'), // JSON blob for action-specific data
  status: text('status').notNull().default('pending'), // 'pending' | 'completed' | 'expired'
  expiresAt: integer('expires_at'), // Unix timestamp
  createdAt: integer('created_at').notNull(),
  completedAt: integer('completed_at'),
});

export type PendingActionRow = typeof pendingActions.$inferSelect;
export type PendingActionInsert = typeof pendingActions.$inferInsert;
