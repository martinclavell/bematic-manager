import type {
  ProjectRepository,
  TaskRepository,
  AuditLogRepository,
  UserRepository,
  OfflineQueueRepository,
} from '@bematic/db';
import type { CommandService } from './services/command.service.js';
import type { ProjectService } from './services/project.service.js';
import type { NotificationService } from './services/notification.service.js';
import type { DeployService } from './services/deploy.service.js';
import type { AgentManager } from './gateway/agent-manager.js';

/** Shared context injected into all Slack listeners */
export interface AppContext {
  // Repositories
  projectRepo: ProjectRepository;
  taskRepo: TaskRepository;
  auditLogRepo: AuditLogRepository;
  userRepo: UserRepository;
  offlineQueueRepo: OfflineQueueRepository;

  // Services
  commandService: CommandService;
  projectService: ProjectService;
  notifier: NotificationService;
  deployService: DeployService;

  // Gateway
  agentManager: AgentManager;

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
}
