import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const archivedTasks = sqliteTable('archived_tasks', {
  id: text('id').primaryKey(),
  originalId: text('original_id').notNull(),
  archivedAt: integer('archived_at', { mode: 'timestamp' }).notNull(),
  taskData: text('task_data').notNull(), // JSON of complete task
  reason: text('reason').notNull(), // 'retention_policy', 'manual', etc.
  projectId: text('project_id'), // For better querying
  userId: text('user_id'), // For better querying
  status: text('status'), // Original task status
  createdAt: integer('created_at', { mode: 'timestamp' }), // Original creation time
});

export type ArchivedTaskRow = typeof archivedTasks.$inferSelect;
export type ArchivedTaskInsert = typeof archivedTasks.$inferInsert;