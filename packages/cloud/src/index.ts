import 'dotenv/config';
import { createServer } from 'node:http';
import { App } from '@slack/bolt';
import { createLogger, Limits } from '@bematic/common';
import {
  getDatabase,
  pushSchema,
  ProjectRepository,
  TaskRepository,
  SessionRepository,
  AuditLogRepository,
  UserRepository,
  OfflineQueueRepository,
} from '@bematic/db';
import { registerAllBots } from '@bematic/bots';
import { loadConfig } from './config.js';
import { registerAllListeners } from './slack/listeners/index.js';
import { createRateLimiter } from './slack/middleware/rate-limit.middleware.js';
import { createAuthChecker } from './slack/middleware/auth.middleware.js';
import { createProjectResolver } from './slack/middleware/project.middleware.js';
import { AgentManager } from './gateway/agent-manager.js';
import { createWSServer } from './gateway/ws-server.js';
import { StreamAccumulator } from './gateway/stream-accumulator.js';
import { MessageRouter } from './gateway/message-router.js';
import { OfflineQueue } from './gateway/offline-queue.js';
import { CommandService } from './services/command.service.js';
import { ProjectService } from './services/project.service.js';
import { NotificationService } from './services/notification.service.js';
import { DeployService } from './services/deploy.service.js';
import type { AppContext } from './context.js';

const logger = createLogger('cloud');

async function main() {
  const config = loadConfig();

  // Initialize database
  logger.info('Initializing database...');
  const db = pushSchema(config.database.url);

  // Initialize repositories
  const projectRepo = new ProjectRepository(db);
  const taskRepo = new TaskRepository(db);
  const sessionRepo = new SessionRepository(db);
  const auditLogRepo = new AuditLogRepository(db);
  const userRepo = new UserRepository(db);
  const offlineQueueRepo = new OfflineQueueRepository(db);

  // Register all bots
  registerAllBots();

  // Initialize Slack app with socket mode
  const app = new App({
    token: config.slack.botToken,
    signingSecret: config.slack.signingSecret,
    appToken: config.slack.appToken,
    socketMode: true,
  });

  // Initialize notification service using the Slack web client
  const notifier = new NotificationService(app.client);

  // Initialize agent manager + gateway
  const agentManager = new AgentManager();

  // Stream accumulator (batches Slack updates)
  const streamAccumulator = new StreamAccumulator(
    Limits.SLACK_STREAM_UPDATE_INTERVAL_MS,
    async (channelId, text, threadTs, messageTs) => {
      return notifier.postOrUpdate(channelId, text, threadTs, messageTs);
    },
  );
  streamAccumulator.start();

  // Offline queue
  const offlineQueue = new OfflineQueue(offlineQueueRepo, agentManager);

  // Message router (handles agent -> Slack responses)
  const messageRouter = new MessageRouter(
    taskRepo,
    auditLogRepo,
    streamAccumulator,
    notifier,
  );

  // Services
  const commandService = new CommandService(
    taskRepo,
    auditLogRepo,
    agentManager,
    offlineQueue,
    notifier,
  );
  const projectService = new ProjectService(projectRepo, auditLogRepo);
  const deployService = new DeployService(config.railway.apiToken);

  // Wire up MessageRouter ↔ CommandService for decomposition support
  messageRouter.setCommandService(commandService, projectRepo);

  // Middleware
  const rateLimiter = createRateLimiter(config);
  const authChecker = createAuthChecker(userRepo);
  const projectResolver = createProjectResolver(projectRepo);

  // Build context
  const ctx: AppContext = {
    projectRepo,
    taskRepo,
    auditLogRepo,
    userRepo,
    offlineQueueRepo,
    commandService,
    projectService,
    notifier,
    deployService,
    agentManager,
    messageRouter,
    authChecker,
    rateLimiter,
    projectResolver,
  };

  // Global error handler
  app.error(async (error) => {
    logger.error({ error }, 'Bolt app error');
  });

  // Debug: log all incoming events
  app.use(async ({ body, next }) => {
    const b = body as Record<string, unknown>;
    logger.info({ type: b['type'], eventType: (b['event'] as any)?.type }, 'Slack event incoming');
    await next();
  });

  // Register Slack event listeners
  registerAllListeners(app, ctx);

  // Start Slack app (socket mode)
  await app.start();
  logger.info('Slack app started in socket mode');

  // Create HTTP server for WS gateway + health check
  const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        agents: agentManager.getConnectedAgentIds().length,
        uptime: process.uptime(),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // Attach WS server to HTTP server
  const wsServer = createWSServer(
    httpServer,
    config,
    agentManager,
    (agentId, raw) => {
      messageRouter.handleAgentMessage(agentId, raw).catch((err) => {
        logger.error({ err, agentId }, 'Error routing agent message');
      });
    },
  );

  httpServer.listen(config.server.port, () => {
    logger.info({ port: config.server.port }, 'HTTP + WS server listening');
  });

  // Periodic cleanup of expired offline queue entries
  setInterval(() => {
    const cleaned = offlineQueue.cleanExpired();
    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned expired offline queue entries');
    }
  }, 60_000);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    streamAccumulator.stop();
    wsServer.close();
    httpServer.close();
    await app.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start cloud service');
  process.exit(1);
});
