import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';

const logger = createLogger('slack:messages');

export function registerMessageListener(app: App, ctx: AppContext) {
  app.message(async ({ message, say }) => {
    // Only handle regular user messages (not bot messages, edits, etc.)
    if (message.subtype) return;
    if (!('text' in message) || !message.text) return;
    if (!('user' in message) || !message.user) return;

    const { text, user, channel, ts } = message as {
      text: string;
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

    logger.info({ user, channel, text: text.slice(0, 100), isThreadReply, threadTs }, 'Channel message received');

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
        slackContext: { channelId: channel, threadTs, userId: user, messageTs: ts },
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
