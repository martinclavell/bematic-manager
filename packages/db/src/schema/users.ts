import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  slackUserId: text('slack_user_id').notNull().unique(),
  slackUsername: text('slack_username').notNull(),
  role: text('role').notNull().default('viewer'),
  rateLimitOverride: integer('rate_limit_override'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const userProjectPermissions = sqliteTable('user_project_permissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id),
  projectId: text('project_id').notNull(),
  permissions: text('permissions').notNull().default('[]'), // JSON array of Permission strings
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type UserProjectPermissionRow = typeof userProjectPermissions.$inferSelect;
