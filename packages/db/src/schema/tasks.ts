import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { projects } from './projects.js';

// Critical performance indexes:
// - status: Fast filtering by task status (pending, running, completed, failed)
// - projectId: Efficient project-based task queries
// - thread: Fast Slack thread lookups using composite (channelId + threadTs)
// - parentTaskId: Quick subtask relationship queries
// - createdAt: Ordered queries and time-based filtering
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
  slackMessageTs: text('slack_message_ts'),
  sessionId: text('session_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  estimatedCost: real('estimated_cost').notNull().default(0),
  maxBudget: real('max_budget').notNull().default(5.0),
  parentTaskId: text('parent_task_id'), // Self-reference for subtasks
  filesChanged: text('files_changed').notNull().default('[]'), // JSON array
  commandsRun: text('commands_run').notNull().default('[]'), // JSON array
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
}, (table) => ({
  statusIdx: index('tasks_status_idx').on(table.status),
  projectIdIdx: index('tasks_project_id_idx').on(table.projectId),
  threadIdx: index('tasks_thread_idx').on(table.slackChannelId, table.slackThreadTs),
  parentTaskIdIdx: index('tasks_parent_task_id_idx').on(table.parentTaskId),
  createdAtIdx: index('tasks_created_at_idx').on(table.createdAt),
}));

export type TaskRow = typeof tasks.$inferSelect;
export type TaskInsert = typeof tasks.$inferInsert;
