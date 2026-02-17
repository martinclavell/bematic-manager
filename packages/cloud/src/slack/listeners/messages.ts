import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';
import { extractFileInfo } from './file-utils.js';

const logger = createLogger('slack:messages');

export function registerMessageListener(app: App, ctx: AppContext) {
  app.message(async ({ message, say }) => {
    // Allow file_share messages through; skip other subtypes (bot_message, message_changed, etc.)
    if (message.subtype && message.subtype !== 'file_share') return;
    if (!('user' in message) || !message.user) return;

    const rawText = ('text' in message ? message.text : '') ?? '';
    const files = ('files' in message ? (message as any).files : undefined) as
      | Array<{ url_private: string; name: string; mimetype: string; filetype: string }>
      | undefined;

    // Extract file info (appended to prompt later, not used for command routing)
    const fileInfo = extractFileInfo(files);

    // Skip if there's no text AND no files
    if (!rawText.trim() && !fileInfo) return;

    // Use raw text for bot/command routing; file info is appended to prompt in CommandService
    const text = rawText || 'Analyze the attached file(s)';
    if (text.trim().length < 1) return;

    const { user, channel, ts } = message as {
      user: string;
      channel: string;
      ts: string;
      thread_ts?: string;
    };

    // Only process messages in channels with a configured project
    const project = ctx.projectResolver.tryResolve(channel);
    if (!project) return;

    // Skip messages that are just slash commands or very short
    if (text.startsWith('/') || text.trim().length < 3) return;

    const threadTs = (message as any).thread_ts ?? ts;
    const isThreadReply = !!(message as any).thread_ts;

    const hasFiles = !!(files && files.length > 0);
    logger.info({ user, channel, text: text.slice(0, 100), isThreadReply, threadTs, hasFiles, fileCount: files?.length ?? 0 }, 'Channel message received');

    // React with hourglass to acknowledge the message
    await ctx.notifier.addReaction(channel, ts, 'hourglass_flowing_sand');

    try {
      // Auth check
      await ctx.authChecker.checkPermission(user, Permission.TASK_CREATE);

      // Rate limit
      const dbUser = ctx.userRepo.findBySlackUserId(user);
      ctx.rateLimiter.check(user, dbUser?.rateLimitOverride ?? null);

      // Try to resolve as a bot command (e.g., "code fix the bug" or "review this file")
      // If text starts with a bot keyword, route to that bot
      // Otherwise default to coder bot with the full text as the prompt
      let resolved = BotRegistry.resolveFromMention(text);

      if (!resolved) {
        // Default: treat the entire message as a coder task
        const coderBot = BotRegistry.get('coder' as any);
        if (!coderBot) return;
        const command = coderBot.parseCommand(text);
        resolved = { bot: coderBot, command };
      }

      const { bot, command } = resolved;

      // Look up previous session in this thread for context continuity
      let resumeSessionId: string | null = null;
      if (isThreadReply) {
        const lastTask = ctx.taskRepo.findLastSessionInThread(channel, threadTs);
        if (lastTask?.sessionId) {
          resumeSessionId = lastTask.sessionId;
          logger.info({ threadTs, resumeSessionId }, 'Resuming thread session');
        }
      }

      // Submit the task (pass messageTs so we can react on completion)
      await ctx.commandService.submit({
        bot,
        command,
        project,
        slackContext: { channelId: channel, threadTs, userId: user, messageTs: ts, fileInfo },
        resumeSessionId,
      });
    } catch (error) {
      logger.error({ error, channel, user }, 'Error handling message');
      // Swap hourglass for error emoji
      await ctx.notifier.removeReaction(channel, ts, 'hourglass_flowing_sand');
      await ctx.notifier.addReaction(channel, ts, 'x');
      const errorMsg =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      await say({ thread_ts: ts, text: `:x: ${errorMsg}` });
    }
  });
}
