import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:mentions');

export function registerMentionListener(app: App, ctx: AppContext) {
  app.event('app_mention', async ({ event, say }) => {
    const { text, channel, ts } = event;
    const user = event.user ?? 'unknown';
    logger.info({ user, channel, text: text.slice(0, 100) }, 'App mention received');

    try {
      // Auth check
      await ctx.authChecker.checkPermission(user, Permission.TASK_CREATE);

      // Rate limit
      const dbUser = ctx.userRepo.findBySlackUserId(user);
      ctx.rateLimiter.check(user, dbUser?.rateLimitOverride ?? null);

      // Resolve project from channel
      const project = ctx.projectResolver.resolve(channel);

      // Resolve bot + parse command
      const resolved = BotRegistry.resolveFromMention(text);
      if (!resolved) {
        await say({
          thread_ts: ts,
          text: 'I couldn\'t understand that command. Try: `@BematicManager code fix <description>` or `@BematicManager help`',
        });
        return;
      }

      const { bot, command } = resolved;

      // Submit the task
      await ctx.commandService.submit({
        bot,
        command,
        project,
        slackContext: { channelId: channel, threadTs: ts, userId: user },
      });
    } catch (error) {
      logger.error({ error, channel, user }, 'Error handling mention');
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      await say({ thread_ts: ts, text: `:x: ${message}` });
    }
  });
}
