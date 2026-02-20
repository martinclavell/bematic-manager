import type {
  DB,
  ProjectRepository,
  TaskRepository,
  AuditLogRepository,
  UserRepository,
  OfflineQueueRepository,
  PromptHistoryRepository,
  ApiKeyRepository,
  NetSuiteConfigRepository,
  PendingActionRepository,
  FeedbackSuggestionRepository,
  ScheduledTaskRepository,
} from '@bematic/db';
import type { CommandService } from './services/command.service.js';
import type { SchedulerService } from './services/scheduler.service.js';
import type { ProjectService } from './services/project.service.js';
import type { NotificationService } from './services/notification.service.js';
import type { DeployService } from './services/deploy.service.js';
import type { ApiKeyService } from './services/api-key.service.js';
import type { HealthService } from './services/health.service.js';
import type { RetentionService } from './services/retention.service.js';
import type { SlackUserService } from './services/slack-user.service.js';
import type { NetSuiteService } from './services/netsuite.service.js';
// import type { CompilationService } from './services/compilation.service.js';
import type { AgentManager } from './gateway/agent-manager.js';
import type { MessageRouter } from './gateway/message-router.js';
import type { AgentHealthTracker } from './gateway/agent-health-tracker.js';
import type { SyncOrchestrator } from './services/sync-orchestrator.service.js';
import type { OpsService } from './services/ops.service.js';

/** Shared context injected into all Slack listeners */
export interface AppContext {
  // Database
  db: DB;

  // Repositories
  projectRepo: ProjectRepository;
  taskRepo: TaskRepository;
  auditLogRepo: AuditLogRepository;
  userRepo: UserRepository;
  offlineQueueRepo: OfflineQueueRepository;
  promptHistoryRepo: PromptHistoryRepository;
  apiKeyRepo: ApiKeyRepository;
  netsuiteConfigRepo: NetSuiteConfigRepository;
  pendingActionRepo: PendingActionRepository;
  feedbackSuggestionRepo: FeedbackSuggestionRepository;
  scheduledTaskRepo: ScheduledTaskRepository;

  // Services
  commandService: CommandService;
  projectService: ProjectService;
  notifier: NotificationService;
  deployService: DeployService;
  apiKeyService: ApiKeyService;
  healthService: HealthService;
  retentionService: RetentionService;
  slackUserService: SlackUserService;
  netsuiteService: NetSuiteService;
  schedulerService: SchedulerService;
  // compilationService: CompilationService;

  // Gateway
  agentManager: AgentManager;
  messageRouter: MessageRouter;
  agentHealthTracker: AgentHealthTracker;
  syncOrchestrator: SyncOrchestrator;
  opsService: OpsService;

  // Middleware helpers
  authChecker: {
    checkPermission(slackUserId: string, permission: string): Promise<void>;
  };
  rateLimiter: {
    check(userId: string, override?: number | null): void;
  };
  projectResolver: {
    resolve(channelId: string): import('@bematic/db').ProjectRow;
    tryResolve(channelId: string): import('@bematic/db').ProjectRow | null;
  };

  // Grouped access to services and repositories
  services: {
    retentionService: RetentionService;
  };
  repositories: {
    archivedTaskRepo: import('@bematic/db').ArchivedTaskRepository;
    scheduledTaskRepo: ScheduledTaskRepository;
  };
}
