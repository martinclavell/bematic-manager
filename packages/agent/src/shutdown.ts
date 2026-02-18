import { createLogger, MessageType, createWSMessage } from '@bematic/common';
import type { WSClient } from './connection/ws-client.js';
import type { QueueProcessor } from './executor/queue-processor.js';

const logger = createLogger('agent-shutdown');

export interface ShutdownDependencies {
  wsClient: WSClient;
  queueProcessor: QueueProcessor;
  agentId: string;
}

/**
 * Creates a graceful shutdown handler for the agent
 */
export function createShutdownHandler(deps: ShutdownDependencies) {
  let isShuttingDown = false;

  return async (signal: string, exitCode: number = 0) => {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress');
      return;
    }
    isShuttingDown = true;

    logger.info({ signal, exitCode }, 'Graceful shutdown initiated');

    // Set shutdown timeout (force exit after 15s)
    const forceExitTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded (15s), forcing exit');
      process.exit(exitCode || 1);
    }, 15_000);

    try {
      // 1. Get currently active tasks
      const activeTasks = deps.queueProcessor.getActiveTasks();
      if (activeTasks.length > 0) {
        logger.warn(
          { activeTaskCount: activeTasks.length },
          'Shutting down with active tasks - they will be cancelled',
        );
      }

      // 2. Cancel all active tasks
      for (const taskId of activeTasks) {
        try {
          const cancelled = deps.queueProcessor.cancel(taskId);
          if (cancelled) {
            logger.info({ taskId }, 'Task cancelled during shutdown');
          }
        } catch (err) {
          logger.error({ err, taskId }, 'Error cancelling task during shutdown');
        }
      }

      // 3. Send final status update to cloud (if still connected)
      try {
        deps.wsClient.send(
          createWSMessage(MessageType.AGENT_STATUS, {
            agentId: deps.agentId,
            status: 'offline',
            activeTasks: [],
            version: '1.0.0',
          }),
        );
      } catch (err) {
        logger.debug({ err }, 'Could not send final status (connection may be closed)');
      }

      // 4. Close WebSocket connection
      logger.info('Closing WebSocket connection...');
      deps.wsClient.close();

      clearTimeout(forceExitTimeout);
      logger.info('Graceful shutdown complete');
      process.exit(exitCode);
    } catch (err) {
      logger.fatal({ err }, 'Error during graceful shutdown');
      clearTimeout(forceExitTimeout);
      process.exit(exitCode || 1);
    }
  };
}
