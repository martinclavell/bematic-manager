import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  userId: text('user_id'),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  metadata: text('metadata').notNull().default('{}'), // JSON
  timestamp: text('timestamp').notNull().$defaultFn(() => new Date().toISOString()),
}, (table) => ({
  userIdIdx: index('audit_logs_user_id_idx').on(table.userId),
  timestampIdx: index('audit_logs_timestamp_idx').on(table.timestamp),
  resourceIdx: index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
}));

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type AuditLogInsert = typeof auditLogs.$inferInsert;
