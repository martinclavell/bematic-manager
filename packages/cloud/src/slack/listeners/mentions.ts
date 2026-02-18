import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';
import { downloadSlackFiles, describeAttachments } from './file-utils.js';

const logger = createLogger('slack:mentions');

export function registerMentionListener(app: App, ctx: AppContext) {
  app.event('app_mention', async ({ event, say, client }) => {
    const { channel, ts } = event;
    const rawText = event.text ?? '';
    const files = ('files' in event ? (event as any).files : undefined) as
      | Array<{ url_private_download?: string; url_private: string; name: string; mimetype: string; filetype: string; size?: number }>
      | undefined;

    const user = event.user ?? 'unknown';
    const hasFiles = !!(files && files.length > 0);
    logger.info({ user, channel, text: rawText.slice(0, 100), hasFiles, fileCount: files?.length ?? 0 }, 'App mention received');

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

      // Download file attachments from Slack
      const attachments = await downloadSlackFiles(files, client.token as string);
      const fileInfo = attachments.length > 0 ? describeAttachments(attachments) : null;

      // Resolve bot + parse command
      const resolved = BotRegistry.resolveFromMention(rawText);
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

      // Submit the task
      await ctx.commandService.submit({
        bot,
        command,
        project,
        slackContext: { channelId: channel, threadTs: ts, userId: user, messageTs: ts, fileInfo, attachments },
      });
    } catch (error) {
      logger.error({ error, channel, user }, 'Error handling mention');
      await ctx.notifier.removeReaction(channel, ts, 'hourglass_flowing_sand');
      await ctx.notifier.addReaction(channel, ts, 'x');
      const message =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      await say({ thread_ts: ts, text: `:x: ${message}` });
    }
  });
}
