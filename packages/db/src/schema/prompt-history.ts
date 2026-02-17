import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const promptHistory = sqliteTable('prompt_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  prompt: text('prompt').notNull(),
  category: text('category'), // e.g., 'feature', 'bugfix', 'refactor', 'documentation', 'research'
  tags: text('tags').notNull().default('[]'), // JSON array for searchable tags
  context: text('context'), // Optional context/notes about the prompt
  relatedFiles: text('related_files').notNull().default('[]'), // JSON array of file paths touched
  executionStatus: text('execution_status').notNull().default('pending'), // pending/completed/failed/cancelled
  executionNotes: text('execution_notes'), // What was actually done
  estimatedDurationMinutes: integer('estimated_duration_minutes'),
  actualDurationMinutes: integer('actual_duration_minutes'),
  timestamp: text('timestamp').notNull().$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
});

export type PromptHistoryRow = typeof promptHistory.$inferSelect;
export type PromptHistoryInsert = typeof promptHistory.$inferInsert;
