import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Stores user feedback suggestions for continuous improvement
 * Enables the system to learn from user input and improve over time
 */
export const feedbackSuggestions = sqliteTable('feedback_suggestions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  taskId: text('task_id'), // Optional: related task
  botName: text('bot_name'), // Which bot the feedback is about
  category: text('category').notNull(), // 'response_quality' | 'code_quality' | 'documentation' | 'performance' | 'other'
  suggestion: text('suggestion').notNull(), // User's detailed suggestion
  context: text('context'), // Additional context about what triggered this
  status: text('status').notNull().default('pending'), // 'pending' | 'reviewed' | 'applied' | 'rejected'
  createdAt: integer('created_at').notNull(),
  reviewedAt: integer('reviewed_at'),
  reviewedBy: text('reviewed_by'), // Admin user who reviewed
  appliedAt: integer('applied_at'),
  appliedNotes: text('applied_notes'), // How the suggestion was applied
});

export type FeedbackSuggestionRow = typeof feedbackSuggestions.$inferSelect;
export type FeedbackSuggestionInsert = typeof feedbackSuggestions.$inferInsert;
