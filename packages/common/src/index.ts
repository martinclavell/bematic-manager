// Constants
export {
  MessageType,
  BotName,
  BOT_KEYWORDS,
  BOT_SLASH_COMMANDS,
  BOT_DEFAULT_BUDGETS,
  MAIN_SLASH_COMMAND,
  UserRole,
  Permission,
  ROLE_PERMISSIONS,
  Limits,
  ModelTier,
  DEFAULT_TIER_MODELS,
  TIER_COST_PER_MILLION,
  OPUS_COMMANDS,
  WRITE_BOTS,
} from './constants/index.js';

// Types
export type {
  WSMessage,
  MessagePayloadMap,
  HeartbeatPingPayload,
  HeartbeatPongPayload,
  TaskAckPayload,
  TaskCancelledPayload,
  AgentStatusPayload,
  AgentMetricsPayload,
  SystemErrorPayload,
  SystemShutdownPayload,
  SystemRestartPayload,
  DeployRequestPayload,
  DeployResultPayload,
  PathValidateRequestPayload,
  PathValidateResultPayload,
  Task,
  TaskSubmitPayload,
  TaskProgressPayload,
  TaskStreamPayload,
  TaskCompletePayload,
  TaskErrorPayload,
  TaskCancelPayload,
  AttachmentResult,
  Project,
  ProjectCreateInput,
  User,
  AuthRequestPayload,
  AuthResponsePayload,
  FileAttachment,
  SlackContext,
  SlackBlockMessage,
  SlackBlock,
  SlackSectionBlock,
  SlackDividerBlock,
  SlackContextBlock,
  SlackActionsBlock,
  SlackHeaderBlock,
  SlackBlockElement,
  BotPlugin,
  BotCommand,
  ParsedCommand,
  BotExecutionConfig,
  SubtaskDefinition,
  ActionType,
  ActionContext,
  ActionResult,
  FeedbackSuggestion,
  FeedbackAnalysis,
} from './types/index.js';
export { TaskStatus } from './types/index.js';
export type { TaskStatusType } from './types/index.js';

// Schemas
export {
  wsMessageEnvelopeSchema,
  authRequestSchema,
  authResponseSchema,
  taskSubmitSchema,
  taskAckSchema,
  taskProgressSchema,
  taskStreamSchema,
  taskCompleteSchema,
  taskErrorSchema,
  taskCancelSchema,
  parsedCommandSchema,
  // Inferred types for better TypeScript support
  type TaskAckData,
  type TaskProgressData,
  type TaskStreamData,
  type TaskCompleteData,
  type TaskErrorData,
  type TaskCancelData,
  type AuthRequestData,
  type AuthResponseData,
  projectCreateSchema,
} from './schemas/index.js';

// Utils
export {
  createLogger,
  BematicError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  AgentOfflineError,
  BudgetExceededError,
  withRetry,
  calculateBackoff,
  generateId,
  generateTaskId,
  generateSessionId,
  generateProjectId,
  generateMessageId,
  createWSMessage,
  serializeMessage,
  parseMessage,
  truncateMessage,
  truncateForSectionBlock,
  TimeParser,
  CronParser,
} from './utils/index.js';
export type { Logger, RetryOptions, TruncationOptions } from './utils/index.js';

// Cache
export {
  CacheManager,
  MemoryCache,
  globalCache,
  projectCache,
  agentCache,
  userCache,
  CacheKeys,
  CacheInvalidators,
} from './cache/index.js';
export type { CacheEntry, CacheStats, CacheOptions } from './cache/index.js';

// Performance Monitoring
export {
  PerformanceMonitor,
  performanceMonitor,
} from './monitoring/index.js';
export type { PerformanceMetrics, PerformanceEvent } from './monitoring/index.js';

// Test utilities (for development and testing)
