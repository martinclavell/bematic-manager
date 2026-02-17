import 'dotenv/config';
import { execSync } from 'node:child_process';
import {
  MessageType,
  createLogger,
  createWSMessage,
  taskSubmitSchema,
  type TaskSubmitPayload,
  type SystemRestartPayload,
  type DeployRequestPayload,
} from '@bematic/common';
import { loadAgentConfig } from './config.js';
import { WSClient } from './connection/ws-client.js';
import { setupHeartbeat } from './connection/heartbeat.js';
import { ClaudeExecutor } from './executor/claude-executor.js';
import { QueueProcessor } from './executor/queue-processor.js';
import { setupFileLogging } from './logging.js';

/** Exit code 75 signals the wrapper script to restart the agent */
const RESTART_EXIT_CODE = 75;

const logger = createLogger('agent');

async function main() {
  const config = loadAgentConfig();

  // Setup file logging
  setupFileLogging(config.logLevel);

  logger.info({ agentId: config.agentId }, 'Starting Bematic Agent');

  // Initialize WebSocket client
  const wsClient = new WSClient(config);

  // Initialize executor and queue processor
  const executor = new ClaudeExecutor(wsClient, config.maxContinuations);
  const queueProcessor = new QueueProcessor(executor, config.maxConcurrentTasks);

  // Setup heartbeat responses
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
        queueProcessor.submit(result.data as TaskSubmitPayload);
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

      case MessageType.SYSTEM_SHUTDOWN: {
        logger.info('Received shutdown signal from cloud');
        shutdown(0);
        break;
      }

      case MessageType.SYSTEM_RESTART: {
        const payload = parsed.payload as SystemRestartPayload;
        logger.info({ reason: payload.reason, rebuild: payload.rebuild }, 'Received restart signal from cloud');
        shutdown(RESTART_EXIT_CODE);
        break;
      }

      default:
        logger.debug({ type: parsed.type }, 'Unhandled message type');
    }
  });

  // On connection, send agent status
  wsClient.on('authenticated', () => {
    wsClient.send(
      createWSMessage(MessageType.AGENT_STATUS, {
        agentId: config.agentId,
        status: 'online',
        activeTasks: queueProcessor.getActiveTasks(),
        version: '1.0.0',
      }),
    );
  });

  wsClient.on('disconnected', () => {
    logger.warn('Disconnected from cloud. Tasks will continue locally.');
  });

  // Connect to cloud
  wsClient.connect();

  // Graceful shutdown
  const shutdown = (exitCode = 0) => {
    logger.info({ exitCode }, 'Shutting down agent...');
    wsClient.close();
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
}

function handleDeploy(wsClient: WSClient, payload: DeployRequestPayload) {
  try {
    logger.info({ localPath: payload.localPath }, 'Running railway up...');
    const output = execSync('railway up --detach', {
      cwd: payload.localPath,
      encoding: 'utf-8',
      timeout: 120_000,
    });

    // Extract build logs URL from output
    const urlMatch = output.match(/(https:\/\/railway\.com\/[^\s]+)/);

    wsClient.send(
      createWSMessage(MessageType.DEPLOY_RESULT, {
        requestId: payload.requestId,
        success: true,
        output: output.trim(),
        buildLogsUrl: urlMatch?.[1],
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? (err as any).stderr || err.message : String(err);
    logger.error({ error: message }, 'Deploy failed');
    wsClient.send(
      createWSMessage(MessageType.DEPLOY_RESULT, {
        requestId: payload.requestId,
        success: false,
        output: message,
      }),
    );
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start agent');
  process.exit(1);
});
