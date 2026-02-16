import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slackChannelId: text('slack_channel_id').notNull().unique(),
  localPath: text('local_path').notNull(),
  agentId: text('agent_id').notNull(),
  defaultModel: text('default_model').notNull().default('claude-sonnet-4-5-20250929'),
  defaultMaxBudget: real('default_max_budget').notNull().default(5.0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
