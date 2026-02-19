/**
 * Cache and performance command handlers
 */
import type { AppContext } from '../../context.js';
import type { AdminCommandHandler } from './admin-handlers.js';

/**
 * Mock app interface for cache/performance command delegation
 */
interface MockApp {
  command: (commandName: string, handler: any) => Promise<void>;
}

/**
 * Handle cache command
 */
export const handleCache: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
  const cacheSubcommand = args[1]?.toLowerCase();
  const cacheArgs = args.slice(1);

  // Import and register cache commands
  const { CacheCommands } = await import('../admin-commands/index.js');

  // Create a mock app with just the command handler we need
  const mockApp: MockApp = {
    command: async (commandName: string, handler: any) => {
      if (commandName === `/cache-${cacheSubcommand}`) {
        // Execute the handler with mock context
        return handler({
          ack: async () => {},
          respond,
          command: {
            user_id: userId,
            text: cacheArgs.slice(1).join(' '),
          }
        });
      }
    }
  };

  // Register the commands with mock app
  CacheCommands(mockApp as any, ctx);

  // Handle the specific cache subcommand
  switch (cacheSubcommand) {
    case 'stats':
      await mockApp.command('/cache-stats', mockApp.command);
      break;
    case 'clear':
      await mockApp.command('/cache-clear', mockApp.command);
      break;
    case 'warm':
      await mockApp.command('/cache-warm', mockApp.command);
      break;
    case 'invalidate-project':
      await mockApp.command('/cache-invalidate-project', mockApp.command);
      break;
    case 'invalidate-agent':
      await mockApp.command('/cache-invalidate-agent', mockApp.command);
      break;
    case 'invalidate-user':
      await mockApp.command('/cache-invalidate-user', mockApp.command);
      break;
    default:
      await respond(
        '*Cache Commands:*\n' +
        '`/bm-admin cache stats` - Show cache statistics\n' +
        '`/bm-admin cache clear` - Clear all caches\n' +
        '`/bm-admin cache warm` - Warm caches with current data\n' +
        '`/bm-admin cache invalidate-project <project-id>` - Invalidate project cache\n' +
        '`/bm-admin cache invalidate-agent <agent-id>` - Invalidate agent cache\n' +
        '`/bm-admin cache invalidate-user <user-id>` - Invalidate user cache\n'
      );
  }
};

/**
 * Handle performance command
 */
export const handlePerformance: AdminCommandHandler = async (args, userId, channelId, respond, ctx) => {
  const perfSubcommand = args[1]?.toLowerCase();
  const perfArgs = args.slice(1);

  // Import and register performance commands
  const { registerPerformanceCommands } = await import('../admin-commands/performance.js');

  // Create a mock app with just the command handler we need
  const mockApp: MockApp = {
    command: async (commandName: string, handler: any) => {
      if (commandName === `/performance-${perfSubcommand}`) {
        // Execute the handler with mock context
        return handler({
          ack: async () => {},
          respond,
          command: {
            user_id: userId,
            text: perfArgs.slice(1).join(' '),
          }
        });
      }
    }
  };

  // Register the commands with mock app
  registerPerformanceCommands(mockApp as any, ctx);

  // Handle the specific performance subcommand
  switch (perfSubcommand) {
    case 'metrics':
      await mockApp.command('/performance-metrics', mockApp.command);
      break;
    case 'summary':
      await mockApp.command('/performance-summary', mockApp.command);
      break;
    case 'events':
      await mockApp.command('/performance-events', mockApp.command);
      break;
    case 'reset':
      await mockApp.command('/performance-reset', mockApp.command);
      break;
    default:
      await respond(
        '*Performance Commands:*\n' +
        '`/bm-admin performance metrics` - Show current performance metrics\n' +
        '`/bm-admin performance summary [minutes]` - Performance summary for time period\n' +
        '`/bm-admin performance events [type] [limit]` - Show recent performance events\n' +
        '`/bm-admin performance reset` - Reset all performance metrics\n'
      );
  }
};