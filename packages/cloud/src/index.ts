import 'dotenv/config';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { App } from '@slack/bolt';
import { createLogger, Limits } from '@bematic/common';
import {
  pushSchema,
  ProjectRepository,
  TaskRepository,
  SessionRepository,
  AuditLogRepository,
  UserRepository,
  OfflineQueueRepository,
  PromptHistoryRepository,
  ApiKeyRepository,
  ArchivedTaskRepository,
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
import { ApiKeyService } from './services/api-key.service.js';
import { HealthService } from './services/health.service.js';
import { RetentionService } from './services/retention.service.js';
import { SlackUserService } from './services/slack-user.service.js';
import { AgentHealthTracker } from './gateway/agent-health-tracker.js';
import { metrics, MetricNames } from './utils/metrics.js';
import { createSecurityHeadersMiddleware, applySecurityHeaders } from './middleware/security-headers.js';
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
  const promptHistoryRepo = new PromptHistoryRepository(db);
  const apiKeyRepo = new ApiKeyRepository(db);
  const archivedTaskRepo = new ArchivedTaskRepository(db);

  // Register all bots
  registerAllBots();

  // Initialize Slack app with socket mode
  const app = new App({
    token: config.slack.botToken,
    signingSecret: config.slack.signingSecret,
    appToken: config.slack.appToken,
    socketMode: true,
  });

  // Initialize notification service
  const notifier = new NotificationService(app.client);

  // Initialize agent manager + gateway
  const agentManager = new AgentManager();

  // Initialize agent health tracker
  const agentHealthTracker = new AgentHealthTracker();

  // Stream accumulator (batches Slack updates)
  const streamAccumulator = new StreamAccumulator(
    Limits.SLACK_STREAM_UPDATE_INTERVAL_MS,
    async (channelId, text, threadTs, messageTs) => {
      return notifier.postOrUpdate(channelId, text, threadTs, messageTs);
    },
  );
  streamAccumulator.start();

  // Offline queue
  const offlineQueue = new OfflineQueue(offlineQueueRepo, agentManager, config);

  // Message router (handles agent -> Slack responses)
  const messageRouter = new MessageRouter(
    taskRepo,
    auditLogRepo,
    streamAccumulator,
    notifier,
    agentHealthTracker,
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
  const apiKeyService = new ApiKeyService(apiKeyRepo, auditLogRepo);

  // Health and retention services
  const healthService = new HealthService(
    taskRepo,
    projectRepo,
    agentManager,
    agentHealthTracker,
    notifier,
  );
  const retentionService = new RetentionService(
    taskRepo,
    sessionRepo,
    auditLogRepo,
    offlineQueueRepo,
    archivedTaskRepo,
  );
  const slackUserService = new SlackUserService(app.client);

  // Wire up MessageRouter <-> CommandService for decomposition support
  messageRouter.setCommandService(commandService, projectRepo);

  // Middleware
  const rateLimiter = createRateLimiter(config);
  const authChecker = createAuthChecker(userRepo);
  const projectResolver = createProjectResolver(projectRepo);
  const securityHeadersMiddleware = createSecurityHeadersMiddleware(config);

  // Build context
  const ctx: AppContext = {
    projectRepo,
    taskRepo,
    auditLogRepo,
    userRepo,
    offlineQueueRepo,
    promptHistoryRepo,
    apiKeyRepo,
    commandService,
    projectService,
    notifier,
    deployService,
    apiKeyService,
    healthService,
    retentionService,
    slackUserService,
    agentManager,
    messageRouter,
    agentHealthTracker,
    authChecker,
    rateLimiter,
    projectResolver,
    services: {
      retentionService,
    },
    repositories: {
      archivedTaskRepo,
    },
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

  // Startup health check
  logger.info('Performing startup health check...');
  try {
    const startupHealth = await healthService.getHealth();
    if (startupHealth.status === 'unhealthy') {
      logger.error({ health: startupHealth }, 'Startup health check failed - system is unhealthy');
      // Continue anyway but log the issue for investigation
    } else {
      logger.info({
        status: startupHealth.status,
        agents: startupHealth.metrics.agents,
        database: startupHealth.components.database.status
      }, 'Startup health check passed');
    }
  } catch (err) {
    logger.error({ err }, 'Startup health check failed with exception');
    // Continue anyway - don't block startup
  }

  // Create HTTP/HTTPS server for WS gateway + health check
  // Start this BEFORE Slack so the healthcheck is available immediately
  const requestHandler = (req: any, res: any) => {
    // Apply security headers to all responses
    securityHeadersMiddleware(req, res, async () => {
      if (req.url === '/health') {
        try {
          const simpleHealth = await healthService.getSimpleHealth();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(simpleHealth));
        } catch (err) {
          logger.error({ err }, 'Health endpoint error');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Health check failed' }));
        }
      } else if (req.url === '/health/detailed') {
        try {
          const detailedHealth = await healthService.getHealth();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(detailedHealth, null, 2));
        } catch (err) {
          logger.error({ err }, 'Detailed health endpoint error');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Health check failed' }));
        }
      } else if (req.url === '/metrics/offline-queue') {
        try {
          const queueMetrics = offlineQueue.getMetrics();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...queueMetrics,
            timestamp: new Date().toISOString(),
          }, null, 2));
        } catch (err) {
          logger.error({ err }, 'Offline queue metrics endpoint error');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Metrics fetch failed' }));
        }
      } else if (req.url === '/security-audit') {
        // Security audit endpoint for testing headers
        applySecurityHeaders(res, config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Security headers applied',
          headers: Object.fromEntries(
            Object.entries(res.getHeaders()).filter(([key]) =>
              key.toLowerCase().includes('security') ||
              key.toLowerCase().startsWith('x-') ||
              key.toLowerCase().includes('cors') ||
              key.toLowerCase().includes('csp') ||
              key.toLowerCase().includes('hsts')
            )
          ),
          timestamp: new Date().toISOString(),
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  };

  let httpServer;
  if (config.ssl.enabled) {
    const httpsOptions: any = {};

    if (config.ssl.certPath && config.ssl.keyPath) {
      try {
        httpsOptions.cert = await readFile(config.ssl.certPath);
        httpsOptions.key = await readFile(config.ssl.keyPath);
        logger.info({ certPath: config.ssl.certPath, keyPath: config.ssl.keyPath }, 'Loaded TLS certificates from files');
      } catch (error) {
        logger.error({ error, certPath: config.ssl.certPath, keyPath: config.ssl.keyPath }, 'Failed to load TLS certificates - falling back to HTTP');
        httpServer = createServer(requestHandler);
      }
    }

    if (httpsOptions.cert && httpsOptions.key) {
      httpServer = createHttpsServer(httpsOptions, requestHandler);
      logger.info('Created HTTPS server with TLS certificates');
    } else {
      // In production environments like Railway, TLS termination is handled by the platform
      httpServer = createServer(requestHandler);
      logger.info('Created HTTP server - TLS termination handled by platform (Railway)');
    }
  } else {
    httpServer = createServer(requestHandler);
    logger.info('Created HTTP server for development');
  }

  // Attach WS server to HTTP server
  const wsServer = createWSServer(
    httpServer,
    config,
    agentManager,
    apiKeyService,
    (agentId, raw) => {
      messageRouter.handleAgentMessage(agentId, raw).catch((err) => {
        logger.error({ err, agentId }, 'Error routing agent message');
      });
    },
  );

  httpServer.listen(config.server.port, () => {
    const protocol = config.ssl.enabled && config.ssl.certPath && config.ssl.keyPath ? 'https' : 'http';
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    logger.info(
      {
        port: config.server.port,
        protocol,
        wsProtocol,
        sslEnabled: config.ssl.enabled,
        enforceWss: config.ssl.enforceWss,
        tlsTermination: config.ssl.enabled && (!config.ssl.certPath || !config.ssl.keyPath) ? 'platform' : 'local'
      },
      'Server listening'
    );
  });

  // Start Slack app (socket mode) after HTTP server is listening
  await app.start();
  logger.info('Slack app started in socket mode');

  // Start periodic drain of offline queue (catches anything missed by event-based drains)
  offlineQueue.startPeriodicDrain(30_000);

  // Periodic cleanup of expired offline queue entries
  setInterval(() => {
    const cleaned = offlineQueue.cleanExpired();
    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned expired offline queue entries');
    }
  }, 60_000);

  // Periodic logging of offline queue metrics (every 5 minutes)
  setInterval(() => {
    const metrics = offlineQueue.getMetrics();
    if (metrics.totalMessages > 0) {
      logger.info({
        ...metrics,
        successRate: ((metrics.successfulDeliveries / metrics.totalMessages) * 100).toFixed(2) + '%'
      }, 'Offline queue performance metrics');
    }
  }, 5 * 60 * 1000);

  // Periodic cleanup of expired/revoked API keys (every 6 hours)
  setInterval(() => {
    try {
      const result = apiKeyService.cleanupExpiredKeys();
      if (result.deleted > 0) {
        logger.info({ deleted: result.deleted }, 'Cleaned expired/revoked API keys');
      }
    } catch (error) {
      logger.error({ error }, 'Error during API key cleanup');
    }
  }, 6 * 60 * 60 * 1000);

  // Scheduled retention cleanup (every 24 hours)
  const runRetentionCleanup = async () => {
    try {
      logger.info('Starting scheduled retention cleanup');
      const results = await retentionService.runRetentionPolicies();
      const totalDeleted = results.tasksDeleted + results.sessionsDeleted +
                          results.auditLogsDeleted + results.offlineQueueDeleted;

      logger.info({ ...results, totalDeleted }, 'Retention cleanup completed');

      // Optionally notify admin channel about cleanup statistics
      // if (totalDeleted > 0) {
      //   await notifier.postMessage(
      //     process.env.ADMIN_CHANNEL_ID,
      //     `🧹 Retention cleanup completed: ${totalDeleted} total records deleted\n` +
      //     `• Tasks: ${results.tasksDeleted}\n` +
      //     `• Sessions: ${results.sessionsDeleted}\n` +
      //     `• Audit logs: ${results.auditLogsDeleted}\n` +
      //     `• Offline queue: ${results.offlineQueueDeleted}`
      //   );
      // }
    } catch (error) {
      logger.error({ error }, 'Error during retention cleanup');
    }
  };

  // Run cleanup every 24 hours (86400000 ms)
  setInterval(runRetentionCleanup, 24 * 60 * 60 * 1000);

  // Run initial cleanup on startup (after 5 minutes to allow system to stabilize)
  setTimeout(runRetentionCleanup, 5 * 60 * 1000);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    offlineQueue.stopPeriodicDrain();
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
