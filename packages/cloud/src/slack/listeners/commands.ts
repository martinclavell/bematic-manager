import type { App } from '@slack/bolt';
import { Permission, BOT_SLASH_COMMANDS, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:commands');

export function registerCommandListeners(app: App, ctx: AppContext) {
  // Register each slash command
  for (const slashCommand of Object.keys(BOT_SLASH_COMMANDS)) {
    app.command(slashCommand, async ({ command, ack, respond }) => {
      await ack();

      const { user_id, channel_id, text } = command;
      logger.info({ command: slashCommand, user: user_id, text: text.slice(0, 100) }, 'Slash command received');

      try {
        await ctx.authChecker.checkPermission(user_id, Permission.TASK_CREATE);

        const dbUser = ctx.userRepo.findBySlackUserId(user_id);
        ctx.rateLimiter.check(user_id, dbUser?.rateLimitOverride);

        const project = ctx.projectResolver.resolve(channel_id);

        const resolved = BotRegistry.resolveFromSlashCommand(slashCommand, text);
        if (!resolved) {
          await respond(`Unknown command. Try: \`${slashCommand} help\``);
          return;
        }

        const { bot, command: parsedCommand } = resolved;

        await ctx.commandService.submit({
          bot,
          command: parsedCommand,
          project,
          slackContext: { channelId: channel_id, threadTs: null, userId: user_id },
        });

        await respond(':hourglass_flowing_sand: Task submitted. I\'ll post results in the channel.');
      } catch (error) {
        logger.error({ error, command: slashCommand }, 'Error handling slash command');
        const message =
          error instanceof Error ? error.message : 'An unexpected error occurred';
        await respond(`:x: ${message}`);
      }
    });
  }
}
