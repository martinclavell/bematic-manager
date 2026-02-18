import { createLogger } from '@bematic/common';

const logger = createLogger('error-handler');

/**
 * Setup global error handlers for unhandled rejections and uncaught exceptions
 */
export function setupGlobalErrorHandlers(): void {
  // Unhandled promise rejections
  process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.fatal({ reason, promise: promise.toString() }, 'Unhandled promise rejection');
    // In production with a process manager (PM2, Railway), you might want to exit
    // and let the manager restart the process
    if (process.env.NODE_ENV === 'production') {
      // Give time for logs to flush
      setTimeout(() => process.exit(1), 1000);
    }
  });

  // Uncaught exceptions - these are fatal and require immediate exit
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ error, stack: error.stack }, 'Uncaught exception - exiting immediately');
    // Exit immediately - uncaught exceptions leave the process in an undefined state
    process.exit(1);
  });

  // Handle warning events (e.g., deprecated APIs)
  process.on('warning', (warning: Error) => {
    logger.warn({ warning: warning.message, stack: warning.stack }, 'Process warning');
  });

  logger.info('Global error handlers configured');
}
