import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { projects } from './projects.js';

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  botName: text('bot_name').notNull(),
  command: text('command').notNull(),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('pending'),
  result: text('result'),
  errorMessage: text('error_message'),
  slackChannelId: text('slack_channel_id').notNull(),
  slackThreadTs: text('slack_thread_ts'),
  slackUserId: text('slack_user_id').notNull(),
  sessionId: text('session_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  estimatedCost: real('estimated_cost').notNull().default(0),
  maxBudget: real('max_budget').notNull().default(5.0),
  filesChanged: text('files_changed').notNull().default('[]'), // JSON array
  commandsRun: text('commands_run').notNull().default('[]'), // JSON array
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
});

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
