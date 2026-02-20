import type { App } from '@slack/bolt';
import { Permission, createLogger } from '@bematic/common';
import { BotRegistry } from '@bematic/bots';
import type { AppContext } from '../../context.js';
import { downloadSlackFiles, describeAttachments } from './file-utils.js';
import { extractFiles, extractThreadTs, type SlackMessage, type SlackFile } from '../../types/slack.js';

const logger = createLogger('slack:messages');

/** Batch multiple file_share messages that arrive close together */
interface FileBatch {
  files: SlackFile[];
  user: string;
  channel: string;
  firstTs: string;
  threadTs: string;
  text: string;
  timer: NodeJS.Timeout;
}

/** Map key: `${channel}:${user}:${threadTs}` */
const fileBatches = new Map<string, FileBatch>();

/** How long to wait for additional files before processing (ms) */
const FILE_BATCH_DELAY_MS = 2000;

export function registerMessageListener(app: App, ctx: AppContext) {
  /**
   * Process a batched file upload (after batching delay expires)
   */
  async function processBatchedFiles(batch: FileBatch, client: any, say: any) {
    const { files, user, channel, firstTs, threadTs, text } = batch;

    logger.info(
      { user, channel, fileCount: files.length, text: text.slice(0, 100) },
      'Processing batched file upload'
    );

    // React with hourglass to acknowledge
    await ctx.notifier.addReaction(channel, firstTs, 'hourglass_flowing_sand');

    try {
      // Preload user info
      await ctx.slackUserService.preloadUserInfo(user);

      // Auth check
      await ctx.authChecker.checkPermission(user, Permission.TASK_CREATE);

      // Rate limit
      const dbUser = ctx.userRepo.findBySlackUserId(user);
      ctx.rateLimiter.check(user, dbUser?.rateLimitOverride ?? null);

      // Download ALL file attachments from Slack
      const attachments = await downloadSlackFiles(files, client.token as string);
      const fileInfo = attachments.length > 0 ? describeAttachments(attachments) : null;

      // Try to resolve as a bot command
      let resolved = BotRegistry.resolveFromMention(text);

      if (!resolved) {
        // Default: treat as coder task
        const coderBot = BotRegistry.get('coder');
        if (!coderBot) return;
        const command = coderBot.parseCommand(text);
        resolved = { bot: coderBot, command };
      }

      const { bot, command } = resolved;

      // Look up previous session in this thread
      let resumeSessionId: string | null = null;
      const isThreadReply = threadTs !== firstTs;
      if (isThreadReply) {
        const lastTask = ctx.taskRepo.findLastSessionInThread(channel, threadTs);
        if (lastTask?.sessionId) {
          resumeSessionId = lastTask.sessionId;
          logger.info({ threadTs, resumeSessionId }, 'Resuming thread session');
        }
      }

      // Resolve project
      const project = ctx.projectResolver.tryResolve(channel);
      if (!project) {
        await ctx.notifier.removeReaction(channel, firstTs, 'hourglass_flowing_sand');
        await ctx.notifier.addReaction(channel, firstTs, 'x');
        return;
      }

      // Submit the task with ALL attachments
      await ctx.commandService.submit({
        bot,
        command,
        project,
        slackContext: {
          channelId: channel,
          threadTs,
          userId: user,
          messageTs: firstTs,
          fileInfo,
          attachments,
        },
        resumeSessionId,
      });
    } catch (error) {
      logger.error({ error, channel, user }, 'Error handling batched files');
      await ctx.notifier.removeReaction(channel, firstTs, 'hourglass_flowing_sand');
      await ctx.notifier.addReaction(channel, firstTs, 'x');
      const errorMsg = error instanceof Error ? error.message : 'An unexpected error occurred';
      await say({ thread_ts: firstTs, text: `:x: ${errorMsg}` });
    }
  }

  app.message(async ({ message, say, client }) => {
    // Allow file_share messages through; skip other subtypes (bot_message, message_changed, etc.)
    if (message.subtype && message.subtype !== 'file_share') return;
    if (!('user' in message) || !message.user) return;

    const rawText = ('text' in message ? message.text : '') ?? '';
    const files = extractFiles(message);

    // Skip if there's no text AND no files
    if (!rawText.trim() && (!files || files.length === 0)) return;

    const { user, channel, ts } = message as SlackMessage;
    const threadTs = extractThreadTs(message) ?? ts;

    // Only process messages in channels with a configured project
    const project = ctx.projectResolver.tryResolve(channel);
    if (!project) return;

    // Handle file_share messages with batching
    if (message.subtype === 'file_share') {
      const batchKey = `${channel}:${user}:${threadTs}`;
      const existingBatch = fileBatches.get(batchKey);

      if (existingBatch) {
        // Add files to existing batch and reset timer
        existingBatch.files.push(...files);
        clearTimeout(existingBatch.timer);
        existingBatch.timer = setTimeout(() => {
          fileBatches.delete(batchKey);
          processBatchedFiles(existingBatch, client, say);
        }, FILE_BATCH_DELAY_MS);

        logger.info(
          { user, channel, batchKey, fileCount: existingBatch.files.length },
          'Added files to existing batch'
        );
      } else {
        // Create new batch
        const newBatch: FileBatch = {
          files: [...files],
          user,
          channel,
          firstTs: ts,
          threadTs,
          text: rawText.trim() || 'Analyze the attached file(s)',
          timer: setTimeout(() => {
            fileBatches.delete(batchKey);
            processBatchedFiles(newBatch, client, say);
          }, FILE_BATCH_DELAY_MS),
        };
        fileBatches.set(batchKey, newBatch);

        logger.info(
          { user, channel, batchKey, fileCount: files.length },
          'Created new file batch'
        );
      }

      return; // Don't process file_share messages immediately
    }

    // For non-file_share messages, process normally
    const text = rawText.trim() || 'Analyze the attached file(s)';
    if (text.length < 1) return;

    // Skip messages that are just slash commands or very short
    if (text.startsWith('/') || text.trim().length < 3) return;

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
