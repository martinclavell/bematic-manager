import 'dotenv/config';
import process from 'node:process';
process.setMaxListeners(20);
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import {
  MessageType,
  createLogger,
  createWSMessage,
  taskSubmitSchema,
  type TaskSubmitPayload,
  type SystemRestartPayload,
  type DeployRequestPayload,
  type PathValidateRequestPayload,
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

  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('SIGINT', () => shutdown('SIGINT', 0));

  logger.info('Bematic Agent fully initialized');
}

async function handlePathValidate(wsClient: WSClient, payload: PathValidateRequestPayload) {
  try {
    logger.info({ localPath: payload.localPath }, 'Validating local path...');

    const pathExists = existsSync(payload.localPath);
    let created = false;

    if (!pathExists) {
      logger.info({ localPath: payload.localPath }, 'Path does not exist, creating...');
      await mkdir(payload.localPath, { recursive: true });
      created = true;
      logger.info({ localPath: payload.localPath }, 'Path created successfully');
    } else {
      logger.info({ localPath: payload.localPath }, 'Path already exists');
    }

    wsClient.send(
      createWSMessage(MessageType.PATH_VALIDATE_RESULT, {
        requestId: payload.requestId,
        success: true,
        exists: pathExists,
        created,
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message, localPath: payload.localPath }, 'Path validation failed');
    wsClient.send(
      createWSMessage(MessageType.PATH_VALIDATE_RESULT, {
        requestId: payload.requestId,
        success: false,
        exists: false,
        created: false,
        error: message,
      }),
    );
  }
}

function handleDeploy(wsClient: WSClient, payload: DeployRequestPayload) {
  logger.info({ localPath: payload.localPath }, 'Running railway up...');

  // Ensure Node 22 is active via nvm before running railway CLI
  const command = process.platform === 'win32'
    ? 'nvm use 22 && railway up --detach'
    : 'source ~/.nvm/nvm.sh && nvm use 22 && railway up --detach';

  exec(command, {
    cwd: payload.localPath,
    encoding: 'utf-8',
    timeout: 120_000,
    shell: process.platform === 'win32' ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe') : '/bin/bash',
    env: process.env,
  }, (err, stdout, stderr) => {
    if (err) {
      const message = stderr || err.message;
      logger.error({ error: message }, 'Deploy failed');
      wsClient.send(
        createWSMessage(MessageType.DEPLOY_RESULT, {
          requestId: payload.requestId,
          success: false,
          output: message,
        }),
      );
      return;
    }

    const output = stdout.trim();
    const urlMatch = output.match(/(https:\/\/railway\.com\/[^\s]+)/);

    wsClient.send(
      createWSMessage(MessageType.DEPLOY_RESULT, {
        requestId: payload.requestId,
        success: true,
        output,
        buildLogsUrl: urlMatch?.[1],
      }),
    );
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start agent');
  process.exit(1);
});
