import { createLogger } from '@bematic/common';

const logger = createLogger('agent-error-handler');

/**
 * Setup global error handlers for the agent process
 */
export function setupGlobalErrorHandlers(): void {
  // Unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.fatal({ reason, promise: promise.toString() }, 'Unhandled promise rejection in agent');

    // In production, try to determine if error is recoverable
    if (process.env.NODE_ENV === 'production') {
      const errorMessage = reason instanceof Error ? reason.message : String(reason);

      // Check if error is likely recoverable (network/API errors)
      const isRecoverable =
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('socket hang up') ||
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('aborted');

      if (isRecoverable) {
        logger.warn({ reason }, 'Recoverable error detected - continuing operation');
        // Don't exit, let reconnection logic handle it
      } else {
        logger.fatal({ reason }, 'Non-recoverable error - exiting in 2 seconds');
        setTimeout(() => process.exit(1), 2000);
      }
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
