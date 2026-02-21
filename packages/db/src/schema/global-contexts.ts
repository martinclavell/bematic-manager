import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Global context categories that can be injected into all Claude sessions
 * Supports hierarchical composition: global → project-level overrides
 *
 * Categories allow organizing contexts by purpose (security, coding-standards, etc.)
 * Priority determines merge order (lower = higher priority)
 */
export const globalContexts = sqliteTable('global_contexts', {
  id: text('id').primaryKey(),
  category: text('category').notNull(), // e.g., 'security', 'coding-standards', 'company-policies'
  name: text('name').notNull(),
  content: text('content').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(100), // Lower = higher priority in merge order
  scope: text('scope').notNull().default('global'), // 'global' | 'project'
  projectId: text('project_id'), // null for global, set for project-specific overrides
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  categoryIdx: index('global_contexts_category_idx').on(table.category),
  enabledIdx: index('global_contexts_enabled_idx').on(table.enabled),
  projectIdIdx: index('global_contexts_project_id_idx').on(table.projectId),
  priorityIdx: index('global_contexts_priority_idx').on(table.priority),
}));

export type GlobalContextRow = typeof globalContexts.$inferSelect;
export type GlobalContextInsert = typeof globalContexts.$inferInsert;
