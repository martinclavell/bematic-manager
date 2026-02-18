import type { Server } from 'node:http';
import type { App } from '@slack/bolt';
import type { Database } from 'better-sqlite3';
import { createLogger } from '@bematic/common';
import type { AgentManager } from './gateway/agent-manager.js';
import type { StreamAccumulator } from './gateway/stream-accumulator.js';

const logger = createLogger('shutdown');

export interface ShutdownDependencies {
  streamAccumulator: StreamAccumulator;
  cleanupInterval: NodeJS.Timeout;
  wsServer: { close: () => void };
  agentManager: AgentManager;
  httpServer: Server;
  slackApp: App;
  database: Database;
}

/**
 * Creates a graceful shutdown handler that properly cleans up all resources
 */
export function createShutdownHandler(deps: ShutdownDependencies) {
  let isShuttingDown = false;

  return async (signal: string) => {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress, ignoring signal');
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, 'Graceful shutdown initiated');

    // Set shutdown timeout (force exit after 30s if graceful shutdown fails)
    const forceExitTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timeout exceeded (30s), forcing exit');
      process.exit(1);
    }, 30_000);

    try {
      // 1. Stop stream accumulator (no more Slack updates)
      logger.info('Stopping stream accumulator...');
      deps.streamAccumulator.stop();

      // 2. Clear periodic cleanup interval
      logger.info('Clearing cleanup interval...');
      clearInterval(deps.cleanupInterval);

      // 3. Close WebSocket server (stop accepting new agent connections)
      logger.info('Closing WebSocket server...');
      deps.wsServer.close();

      // 4. Notify all connected agents to gracefully disconnect
      const agentIds = deps.agentManager.getConnectedAgentIds();
      if (agentIds.length > 0) {
        logger.info({ agentCount: agentIds.length }, 'Disconnecting agents...');
        for (const agentId of agentIds) {
          try {
            deps.agentManager.disconnect(agentId);
          } catch (err) {
            logger.error({ err, agentId }, 'Error disconnecting agent');
          }
        }
      }

      // 5. Close HTTP server (stop accepting new HTTP requests)
      logger.info('Closing HTTP server...');
      await new Promise<void>((resolve) => {
        deps.httpServer.close(() => {
          logger.info('HTTP server closed');
          resolve();
        });
      });

      // 6. Stop Slack app (disconnect from Slack)
      logger.info('Stopping Slack app...');
      await deps.slackApp.stop();

      // 7. Close database connection
      logger.info('Closing database connection...');
      deps.database.close();

      clearTimeout(forceExitTimeout);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.fatal({ err }, 'Error during graceful shutdown');
      clearTimeout(forceExitTimeout);
      process.exit(1);
    }
  };
}
