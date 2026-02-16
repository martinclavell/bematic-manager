export { getDatabase, closeDatabase } from './connection.js';
export type { DB } from './connection.js';
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
} from './schema/index.js';

// Repositories
export {
  ProjectRepository,
  TaskRepository,
  SessionRepository,
  AuditLogRepository,
  UserRepository,
  OfflineQueueRepository,
} from './repositories/index.js';
