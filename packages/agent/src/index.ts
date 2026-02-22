import './bootstrap.js';
import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import {
  MessageType,
  createLogger,
  createWSMessage,
  taskSubmitSchema,
  type TaskSubmitPayload,
  type SystemRestartPayload,
  type DeployRequestPayload,
  type PathValidateRequestPayload,
  type EnvUpdateRequestPayload,
} from '@bematic/common';
import { loadAgentConfig } from './config.js';
import { setupGlobalErrorHandlers } from './error-handlers.js';
import { createShutdownHandler } from './shutdown.js';
import { WSClient } from './connection/ws-client.js';
import { setupHeartbeat } from './connection/heartbeat.js';
import { ClaudeExecutor } from './executor/claude-executor.js';
import { QueueProcessor } from './executor/queue-processor.js';
import { setupFileLogging } from './logging.js';
import { ResourceMonitor } from './monitoring/resource-monitor.js';
import { handleDeploy, handlePathValidate, handleEnvUpdate } from './handlers/index.js';
const __agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: resolve(__agentRoot, '.env') });

/** Exit code 75 signals the wrapper script to restart the agent */
const RESTART_EXIT_CODE = 75;

const logger = createLogger('agent');

// Setup global error handlers first
setupGlobalErrorHandlers();

async function main() {
  const config = loadAgentConfig();

  // Setup file logging
  setupFileLogging(config.logLevel);

  logger.info({ agentId: config.agentId }, 'Starting Bematic Agent');

  // Warn if ANTHROPIC_API_KEY looks like a placeholder (common in .env.example files)
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (apiKey && (apiKey.includes('your') || apiKey.length < 40)) {
    logger.warn(
      { keyPreview: apiKey.slice(0, 15) + '...' },
      'ANTHROPIC_API_KEY appears to be a placeholder — it will be ignored. Using OAuth credentials instead.',
    );
  }

  // Initialize resource monitoring
  const resourceMonitor = new ResourceMonitor(config.resourceLimits);

  // Start monitoring resources immediately
  resourceMonitor.startMonitoring();

  logger.info(
    { limits: config.resourceLimits },
    'Resource monitoring started with configured limits'
  );

  // Initialize WebSocket client
  const wsClient = new WSClient(config);

  // Initialize executor and queue processor with resource monitoring
  const executor = new ClaudeExecutor(wsClient, config.maxContinuations, config.resourceLimits);
  const queueProcessor = new QueueProcessor(executor, config.maxConcurrentTasks, resourceMonitor);

  // Setup resource monitoring event handlers
  resourceMonitor.on('resource-limit', (event) => {
    logger.warn(
      {
        resource: event.resource,
        usage: event.usage,
        limit: event.limit,
        action: event.type,
        healthScore: event.status.healthScore,
      },
      `Resource limit triggered: ${event.type}`
    );

    // Handle different resource actions
    switch (event.type) {
      case 'reject_new_tasks':
        // Queue processor will check canAcceptNewTasks() before processing
        break;

      case 'cancel_lowest_priority':
        // Cancel the task with lowest priority (oldest task in queue)
        const cancelledTaskId = queueProcessor.cancelLowestPriorityTask();
        if (cancelledTaskId) {
          wsClient.send(
            createWSMessage(MessageType.TASK_CANCELLED, {
              taskId: cancelledTaskId,
              reason: `Resource exhaustion: ${event.resource} at ${event.usage.toFixed(1)}%`,
            }),
          );
          logger.warn({ taskId: cancelledTaskId }, 'Cancelled task due to resource exhaustion');
        }
        break;

      case 'graceful_shutdown':
        logger.error(
          { resource: event.resource, usage: event.usage },
          'Resource exhaustion detected - initiating graceful shutdown'
        );
        shutdown('RESOURCE_EXHAUSTION', RESTART_EXIT_CODE);
        break;
    }
  });

  // Setup heartbeat responses with resource status
  setupHeartbeat(wsClient, config.agentId, queueProcessor);

  // Handle incoming messages from cloud
  wsClient.on('message', (msg) => {
    const parsed = msg as { type: string; payload: unknown };

    switch (parsed.type) {
      case MessageType.TASK_SUBMIT: {
        const result = taskSubmitSchema.safeParse(parsed.payload);
        if (!result.success) {
          logger.error({ errors: result.error.issues }, 'Invalid task submit payload');
          return;
        }

        try {
          queueProcessor.submit(result.data as TaskSubmitPayload);
        } catch (error) {
          // Handle resource limit rejections
          const taskPayload = result.data as TaskSubmitPayload;
          const errorMessage = error instanceof Error ? error.message : String(error);

          logger.error(
            { taskId: taskPayload.taskId, error: errorMessage },
            'Task submission failed due to resource limits'
          );

          wsClient.send(
            createWSMessage(MessageType.TASK_ERROR, {
              taskId: taskPayload.taskId,
              error: errorMessage,
              recoverable: false,
              sessionId: null,
            }),
          );
        }
        break;
      }

      case MessageType.TASK_CANCEL: {
        const payload = parsed.payload as { taskId: string; reason: string };
        const cancelled = queueProcessor.cancel(payload.taskId);
        if (cancelled) {
          wsClient.send(
            createWSMessage(MessageType.TASK_CANCELLED, {
              taskId: payload.taskId,
              reason: payload.reason,
            }),
          );
        }
        break;
      }

      case MessageType.DEPLOY_REQUEST: {
        const payload = parsed.payload as DeployRequestPayload;
        logger.info({ requestId: payload.requestId, localPath: payload.localPath }, 'Deploy request received');
        handleDeploy(wsClient, payload);
        break;
      }

      case MessageType.PATH_VALIDATE_REQUEST: {
        const payload = parsed.payload as PathValidateRequestPayload;
        logger.info({ requestId: payload.requestId, localPath: payload.localPath }, 'Path validation request received');
        handlePathValidate(wsClient, payload);
        break;
      }

      case MessageType.ENV_UPDATE_REQUEST: {
        const payload = parsed.payload as EnvUpdateRequestPayload;
        logger.info({ requestId: payload.requestId, operation: payload.operation, key: payload.key }, 'Env update request received');
        handleEnvUpdate(wsClient, payload);
        break;
      }

      case MessageType.SYSTEM_SHUTDOWN: {
        logger.info('Received shutdown signal from cloud');
        shutdown('SYSTEM_SHUTDOWN', 0);
        break;
      }

      case MessageType.SYSTEM_RESTART: {
        const payload = parsed.payload as SystemRestartPayload;
        logger.info({ reason: payload.reason, rebuild: payload.rebuild }, 'Received restart signal from cloud');
        shutdown('SYSTEM_RESTART', RESTART_EXIT_CODE);
        break;
      }

      default:
        logger.debug({ type: parsed.type }, 'Unhandled message type');
    }
  });

  // On connection, send agent status with resource information
  wsClient.on('authenticated', () => {
    const resourceStatus = resourceMonitor.reportStatus();
    wsClient.send(
      createWSMessage(MessageType.AGENT_STATUS, {
        agentId: config.agentId,
        status: 'online',
        activeTasks: queueProcessor.getActiveTasks(),
        version: '1.0.0',
        resourceStatus: {
          healthScore: resourceStatus.healthScore,
          memoryUsagePercent: resourceStatus.memory.percentUsed,
          cpuUsagePercent: resourceStatus.cpu.percent,
          canAcceptTasks: resourceMonitor.canAcceptNewTasks(),
        },
      }),
    );
  });

  wsClient.on('disconnected', () => {
    logger.warn('Disconnected from cloud. Tasks will continue locally.');
  });

  // Connect to cloud
  wsClient.connect();

  // Graceful shutdown using new handler with resource monitor
  const shutdown = createShutdownHandler({
    wsClient,
    queueProcessor,
    executor,
    agentId: config.agentId,
    resourceMonitor,
  });

  logger.info('Bematic Agent fully initialized');
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start agent');
  process.exit(1);
});
