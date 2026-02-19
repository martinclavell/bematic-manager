import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const netsuiteConfigs = sqliteTable('netsuite_configs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().unique(),
  accountNumber: text('account_number').notNull(),
  productionUrl: text('production_url').notNull(),
  sandboxUrl: text('sandbox_url'),
  restletUrl: text('restlet_url').notNull(),
  consumerKey: text('consumer_key').notNull(), // Encrypted
  consumerSecret: text('consumer_secret').notNull(), // Encrypted
  tokenId: text('token_id').notNull(), // Encrypted
  tokenSecret: text('token_secret').notNull(), // Encrypted
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export type NetSuiteConfigRow = typeof netsuiteConfigs.$inferSelect;
export type NetSuiteConfigInsert = typeof netsuiteConfigs.$inferInsert;
