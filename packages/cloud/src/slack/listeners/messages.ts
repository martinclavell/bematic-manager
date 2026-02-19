import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';
import { downloadSlackFiles, describeAttachments } from './file-utils.js';
import { extractFiles, extractThreadTs, type SlackMessage } from '../../types/slack.js';

const logger = createLogger('slack:messages');

export function registerMessageListener(app: App, ctx: AppContext) {
  app.message(async ({ message, say, client }) => {
    // Allow file_share messages through; skip other subtypes (bot_message, message_changed, etc.)
    if (message.subtype && message.subtype !== 'file_share') return;
    if (!('user' in message) || !message.user) return;

    const rawText = ('text' in message ? message.text : '') ?? '';
    const files = extractFiles(message);

    // Skip if there's no text AND no files
    if (!rawText.trim() && (!files || files.length === 0)) return;

    // Use raw text for bot/command routing; default to "Analyze" if only files
    const text = rawText.trim() || 'Analyze the attached file(s)';
    if (text.length < 1) return;

    const { user, channel, ts } = message as SlackMessage;

    // Only process messages in channels with a configured project
    const project = ctx.projectResolver.tryResolve(channel);
    if (!project) return;

    // Skip messages that are just slash commands or very short
    if (text.startsWith('/') || text.trim().length < 3) return;

    const threadTs = extractThreadTs(message) ?? ts;
    const isThreadReply = !!extractThreadTs(message);

    const hasFiles = !!(files && files.length > 0);
    logger.info({ user, channel, text: text.slice(0, 100), isThreadReply, threadTs, hasFiles, fileCount: files?.length ?? 0 }, 'Channel message received');

    // React with hourglass to acknowledge the message
    await ctx.notifier.addReaction(channel, ts, 'hourglass_flowing_sand');

    try {
      // Preload user info into cache for better performance
      await ctx.slackUserService.preloadUserInfo(user);

      // Auth check
      await ctx.authChecker.checkPermission(user, Permission.TASK_CREATE);

      // Rate limit
      const dbUser = ctx.userRepo.findBySlackUserId(user);
      ctx.rateLimiter.check(user, dbUser?.rateLimitOverride ?? null);

      // Download file attachments from Slack
      const attachments = await downloadSlackFiles(files, client.token as string);
      const fileInfo = attachments.length > 0 ? describeAttachments(attachments) : null;

      // Try to resolve as a bot command (e.g., "code fix the bug" or "review this file")
      let resolved = BotRegistry.resolveFromMention(text);

      if (!resolved) {
        // Default: treat the entire message as a coder task
        const coderBot = BotRegistry.get('coder');
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

      // Submit the task
      await ctx.commandService.submit({
        bot,
        command,
        project,
        slackContext: { channelId: channel, threadTs, userId: user, messageTs: ts, fileInfo, attachments },
        resumeSessionId,
      });
    } catch (error) {
      logger.error({ error, channel, user }, 'Error handling message');
      await ctx.notifier.removeReaction(channel, ts, 'hourglass_flowing_sand');
      await ctx.notifier.addReaction(channel, ts, 'x');
      const errorMsg =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      await say({ thread_ts: ts, text: `:x: ${errorMsg}` });
    }
  });
}
