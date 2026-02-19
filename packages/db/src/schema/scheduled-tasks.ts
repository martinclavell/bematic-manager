import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { projects } from './projects.js';

// Scheduled tasks for cron jobs, reminders, and delayed prompt execution
// Supports one-time and recurring scheduled tasks
export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  userId: text('user_id').notNull(),

  // Task definition
  taskType: text('task_type').notNull(), // 'reminder' | 'prompt_execution' | 'recurring_job'
  botName: text('bot_name').notNull(),
  command: text('command').notNull(),
  prompt: text('prompt').notNull(),

  // Scheduling
  scheduledFor: text('scheduled_for').notNull(), // ISO timestamp for next execution
  timezone: text('timezone').notNull(), // e.g., 'America/New_York'
  cronExpression: text('cron_expression'), // for recurring tasks (e.g., '0 0 * * *')

  // Recurrence
  isRecurring: integer('is_recurring', { mode: 'boolean' }).notNull().default(false),
  lastExecutedAt: text('last_executed_at'),
  nextExecutionAt: text('next_execution_at'), // cached next run time
  executionCount: integer('execution_count').notNull().default(0),
  maxExecutions: integer('max_executions'), // limit for recurring tasks

  // Status
  status: text('status').notNull().default('pending'), // 'pending' | 'active' | 'paused' | 'completed' | 'cancelled' | 'failed'
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

  // Metadata
  slackChannelId: text('slack_channel_id').notNull(),
  slackThreadTs: text('slack_thread_ts'), // original thread context
  metadata: text('metadata').notNull().default('{}'), // JSON: { reminderType, context, files, etc. }

  // Audit
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
  lastTriggeredAt: text('last_triggered_at'),
  expiresAt: text('expires_at'), // auto-cancel after this date
}, (table) => ({
  nextExecutionIdx: index('scheduled_tasks_next_execution_idx').on(table.nextExecutionAt),
  statusEnabledIdx: index('scheduled_tasks_status_enabled_idx').on(table.status, table.enabled),
  projectIdIdx: index('scheduled_tasks_project_id_idx').on(table.projectId),
  userIdIdx: index('scheduled_tasks_user_id_idx').on(table.userId),
}));

export type ScheduledTaskRow = typeof scheduledTasks.$inferSelect;
export type ScheduledTaskInsert = typeof scheduledTasks.$inferInsert;
