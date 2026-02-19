import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { tasks } from './tasks.js';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  agentId: text('agent_id').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  estimatedCost: real('estimated_cost').notNull().default(0),
  durationMs: integer('duration_ms'),
  status: text('status').notNull().default('active'),
  expiresAt: text('expires_at').notNull().$defaultFn(() => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
  lastActivityAt: text('last_activity_at').notNull().$defaultFn(() => new Date().toISOString()),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
});

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
