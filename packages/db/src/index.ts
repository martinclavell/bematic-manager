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
  netsuiteConfigs,
  pendingActions,
  feedbackSuggestions,
  scheduledTasks,
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
  NetSuiteConfigRow,
  NetSuiteConfigInsert,
  PendingActionRow,
  PendingActionInsert,
  FeedbackSuggestionRow,
  FeedbackSuggestionInsert,
  ScheduledTaskRow,
  ScheduledTaskInsert,
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
  NetSuiteConfigRepository,
  PendingActionRepository,
  FeedbackSuggestionRepository,
  ScheduledTaskRepository,
} from './repositories/index.js';
