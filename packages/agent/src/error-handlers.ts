import { createLogger } from '@bematic/common';

const logger = createLogger('agent-error-handler');

/**
 * Setup global error handlers for the agent process
 */
export function setupGlobalErrorHandlers(): void {
  // Unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.fatal({ reason, promise: promise.toString() }, 'Unhandled promise rejection in agent');
    // Agents should try to recover if possible, but log fatally
    // The wrapper script (start-agent.sh) will restart if we exit
    if (process.env.NODE_ENV === 'production') {
      setTimeout(() => process.exit(1), 1000);
    }
  });

  // Uncaught exceptions - fatal, must exit
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ error, stack: error.stack }, 'Uncaught exception in agent - exiting');
    process.exit(1);
  });

  // Process warnings
  process.on('warning', (warning: Error) => {
    logger.warn({ warning: warning.message, stack: warning.stack }, 'Process warning');
  });

  logger.info('Agent global error handlers configured');
}
