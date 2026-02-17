import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';
import { extractFileInfo } from './file-utils.js';

const logger = createLogger('slack:mentions');

export function registerMentionListener(app: App, ctx: AppContext) {
  app.event('app_mention', async ({ event, say }) => {
    const { channel, ts } = event;
    const rawText = event.text ?? '';
    const files = ('files' in event ? (event as any).files : undefined) as
      | Array<{ url_private: string; name: string; mimetype: string; filetype: string }>
      | undefined;

    // Build the effective text: original text + any attached file references
    const fileInfo = extractFileInfo(files);
    const text = fileInfo ? [rawText, fileInfo].filter(Boolean).join('\n\n') : rawText;

    const user = event.user ?? 'unknown';
    const hasFiles = !!(files && files.length > 0);
    logger.info({ user, channel, text: text.slice(0, 100), hasFiles, fileCount: files?.length ?? 0 }, 'App mention received');

    // React with hourglass to acknowledge the mention
    await ctx.notifier.addReaction(channel, ts, 'hourglass_flowing_sand');

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
        await ctx.notifier.removeReaction(channel, ts, 'hourglass_flowing_sand');
        await ctx.notifier.addReaction(channel, ts, 'warning');
        await say({
          thread_ts: ts,
          text: 'I couldn\'t understand that command. Try: `@BematicManager code fix <description>` or `@BematicManager help`',
        });
        return;
      }

      const { bot, command } = resolved;

      // Submit the task (pass messageTs so we can react on completion)
      await ctx.commandService.submit({
        bot,
        command,
        project,
        slackContext: { channelId: channel, threadTs: ts, userId: user, messageTs: ts },
      });
    } catch (error) {
      logger.error({ error, channel, user }, 'Error handling mention');
      // Swap hourglass for error emoji
      await ctx.notifier.removeReaction(channel, ts, 'hourglass_flowing_sand');
      await ctx.notifier.addReaction(channel, ts, 'x');
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      await say({ thread_ts: ts, text: `:x: ${message}` });
    }
  });
}
