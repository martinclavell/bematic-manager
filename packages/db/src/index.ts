export { getDatabase, closeDatabase } from './connection.js';
export type { DB, DB as Database } from './connection.js';
export { pushSchema } from './migrate.js';

// Schema
export {
  projects,
  tasks,
  sessions,
  auditLogs,
  users,
  userProjectPermissions,
  offlineQueue,
  promptHistory,
  apiKeys,
  archivedTasks,
} from './schema/index.js';
export type {
  ProjectRow,
  ProjectInsert,
  TaskRow,
  TaskInsert,
  SessionRow,
  SessionInsert,
  AuditLogRow,
  AuditLogInsert,
  UserRow,
  UserInsert,
  UserProjectPermissionRow,
  OfflineQueueRow,
  OfflineQueueInsert,
  PromptHistoryRow,
  PromptHistoryInsert,
  ApiKeyRow,
  ApiKeyInsert,
  ArchivedTaskRow,
  ArchivedTaskInsert,
} from './schema/index.js';

// Repositories
export {
  ProjectRepository,
  TaskRepository,
  SessionRepository,
  AuditLogRepository,
  UserRepository,
  OfflineQueueRepository,
  PromptHistoryRepository,
  ApiKeyRepository,
  ArchivedTaskRepository,
} from './repositories/index.js';
