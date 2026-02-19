import { createLogger, type SlackBlock } from '@bematic/common';
import { withSlackRetry, FailedNotificationQueue } from '../utils/slack-retry.js';
import { metrics, MetricNames } from '../utils/metrics.js';

type WebClient = import('@slack/bolt').App['client'];

const logger = createLogger('notification');

export class NotificationService {
  private failedQueue = new FailedNotificationQueue();

  constructor(private readonly client: WebClient) {}

  async postMessage(
    channel: string,
    text: string,
    threadTs?: string | null,
  ): Promise<string | undefined> {
    const startTime = Date.now();

    try {
      const result = await withSlackRetry(
        () =>
          this.client.chat.postMessage({
            channel,
            text,
            thread_ts: threadTs ?? undefined,
          }),
        { operation: 'postMessage', channel },
      );

      // Track successful metrics
      const duration = Date.now() - startTime;
      metrics.increment(MetricNames.SLACK_MESSAGES_SENT);
      metrics.histogram(MetricNames.SLACK_API_LATENCY, duration);

      return result.ts;
    } catch (error) {
      // Track failed metrics
      const duration = Date.now() - startTime;
      metrics.increment(MetricNames.SLACK_MESSAGES_FAILED);
      metrics.histogram(MetricNames.SLACK_API_LATENCY, duration);

      logger.error({ error, channel }, 'Failed to post Slack message after retries');
      this.failedQueue.enqueue('postMessage', channel, { text, threadTs }, error);
      return undefined;
    }
  }

  async postBlocks(
    channel: string,
    blocks: SlackBlock[],
    fallbackText: string,
    threadTs?: string | null,
  ): Promise<string | undefined> {
    const startTime = Date.now();

    try {
      const result = await withSlackRetry(
        () =>
          this.client.chat.postMessage({
            channel,
            blocks: blocks as any[],
            text: fallbackText,
            thread_ts: threadTs ?? undefined,
          }),
        { operation: 'postBlocks', channel },
      );

      // Track successful metrics
      const duration = Date.now() - startTime;
      metrics.increment(MetricNames.SLACK_MESSAGES_SENT);
      metrics.histogram(MetricNames.SLACK_API_LATENCY, duration);

      return result.ts;
    } catch (error) {
      // Track failed metrics
      const duration = Date.now() - startTime;
      metrics.increment(MetricNames.SLACK_MESSAGES_FAILED);
      metrics.histogram(MetricNames.SLACK_API_LATENCY, duration);

      logger.error({ error, channel }, 'Failed to post Slack blocks after retries');
      this.failedQueue.enqueue('postBlocks', channel, { blocks, fallbackText, threadTs }, error);
      return undefined;
    }
  }

  async updateMessage(
    channel: string,
    text: string,
    messageTs: string,
  ): Promise<string | null> {
    try {
      const result = await withSlackRetry(
        () =>
          this.client.chat.update({
            channel,
            ts: messageTs,
            text,
          }),
        { operation: 'updateMessage', channel },
      );
      return result.ts ?? null;
    } catch (error) {
      logger.error({ error, channel, messageTs }, 'Failed to update Slack message after retries');
      this.failedQueue.enqueue('updateMessage', channel, { text, messageTs }, error);
      return null;
    }
  }

  /** Add an emoji reaction to a message */
  async addReaction(
    channel: string,
    timestamp: string,
    emoji: string,
  ): Promise<void> {
    try {
      await withSlackRetry(
        () => this.client.reactions.add({ channel, timestamp, name: emoji }),
        { operation: 'addReaction', channel },
        {
          shouldRetry: (error: unknown) => {
            // Don't retry "already_reacted" errors
            const errorCode = (error as any)?.data?.error;
            if (errorCode === 'already_reacted') {
              return false;
            }
            // Use default retry logic for other errors
            return true;
          },
        },
      );
    } catch (error) {
      // Ignore "already_reacted" errors
      if ((error as any)?.data?.error !== 'already_reacted') {
        logger.error({ error, channel, timestamp, emoji }, 'Failed to add reaction after retries');
      }
    }
  }

  /** Remove an emoji reaction from a message */
  async removeReaction(
    channel: string,
    timestamp: string,
    emoji: string,
  ): Promise<void> {
    try {
      await withSlackRetry(
        () => this.client.reactions.remove({ channel, timestamp, name: emoji }),
        { operation: 'removeReaction', channel },
        {
          shouldRetry: (error: unknown) => {
            // Don't retry "no_reaction" errors
            const errorCode = (error as any)?.data?.error;
            if (errorCode === 'no_reaction') {
              return false;
            }
            return true;
          },
        },
      );
    } catch (error) {
      // Ignore "no_reaction" errors
      if ((error as any)?.data?.error !== 'no_reaction') {
        logger.error(
          { error, channel, timestamp, emoji },
          'Failed to remove reaction after retries',
        );
      }
    }
  }

  /** Post or update a streaming message */
  async postOrUpdate(
    channel: string,
    text: string,
    threadTs: string | null,
    existingTs: string | null,
  ): Promise<string | null> {
    if (existingTs) {
      return this.updateMessage(channel, text, existingTs);
    }
    const ts = await this.postMessage(channel, text, threadTs);
    return ts ?? null;
  }

  /** Get failed notifications for admin review */
  getFailedNotifications() {
    return this.failedQueue.getAll();
  }

  /** Get count of failed notifications */
  getFailedCount(): number {
    return this.failedQueue.size();
  }

  /** Clear failed notifications queue */
  clearFailedNotifications(): void {
    this.failedQueue.clear();
  }

  /**
   * Notify users about attachment failures with warning emoji and ephemeral message
   */
  async notifyAttachmentFailures(
    channel: string,
    messageTs: string,
    failedAttachments: Array<{ name: string; error: string; retries: number }>,
    userId: string,
    threadTs?: string | null
  ): Promise<void> {
    try {
      // Add warning emoji reaction to original message
      await this.addReaction(channel, messageTs, 'warning');

      // Create ephemeral message with failure details
      const attachmentList = failedAttachments
        .map(f => `• \`${f.name}\` - ${f.error} (${f.retries} ${f.retries === 1 ? 'retry' : 'retries'})`)
        .join('\n');

      const ephemeralText = `:warning: **Attachment Processing Failed**

The following files could not be processed:
${attachmentList}

**What you can do:**
• Re-upload the files in a different format (PDF, TXT, PNG, JPG)
• Try smaller file sizes
• Check that files aren't corrupted
• Continue without these files - the task will proceed normally`;

      await withSlackRetry(
        () => this.client.chat.postEphemeral({
          channel,
          user: userId,
          text: ephemeralText,
          thread_ts: threadTs ?? undefined,
        }),
        { operation: 'postAttachmentFailureEphemeral', channel }
      );

      logger.info(
        {
          channel,
          userId,
          failedCount: failedAttachments.length,
          failedFiles: failedAttachments.map(f => f.name)
        },
        'Sent attachment failure notification'
      );

    } catch (error) {
      logger.error(
        {
          error,
          channel,
          userId,
          failedAttachments: failedAttachments.map(f => f.name)
        },
        'Failed to send attachment failure notification'
      );
    }
  }

  /**
   * Send a follow-up message with attachment retry suggestions
   */
  async postAttachmentRetryMessage(
    channel: string,
    failedCount: number,
    threadTs?: string | null
  ): Promise<void> {
    const message = `:warning: ${failedCount} attachment${failedCount > 1 ? 's' : ''} failed to process. The task will continue without ${failedCount > 1 ? 'them' : 'it'}.

**Retry suggestions:**
• Re-upload in a different format (PDF, TXT, PNG, JPG)
• Try smaller file sizes (under 10MB recommended)
• Ensure files aren't corrupted or password-protected`;

    await this.postMessage(channel, message, threadTs);
  }

  /**
   * Upload a file to Slack
   */
  async uploadFile(
    channel: string,
    filePath: string,
    filename: string,
    title?: string,
    initialComment?: string,
    threadTs?: string | null,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await withSlackRetry(
        async () => {
          const fs = await import('node:fs/promises');
          const fileContent = await fs.readFile(filePath);

          return this.client.files.uploadV2({
            channel_id: channel,
            file: fileContent,
            filename,
            title: title || filename,
            initial_comment: initialComment,
            thread_ts: threadTs ?? undefined,
          });
        },
        { operation: 'uploadFile', channel },
      );

      // Track successful metrics
      const duration = Date.now() - startTime;
      metrics.increment(MetricNames.SLACK_MESSAGES_SENT);
      metrics.histogram(MetricNames.SLACK_API_LATENCY, duration);

      logger.info({ channel, filename, threadTs }, 'File uploaded successfully');
    } catch (error) {
      // Track failed metrics
      const duration = Date.now() - startTime;
      metrics.increment(MetricNames.SLACK_MESSAGES_FAILED);
      metrics.histogram(MetricNames.SLACK_API_LATENCY, duration);

      logger.error({ error, channel, filename }, 'Failed to upload file to Slack after retries');
      this.failedQueue.enqueue('uploadFile', channel, { filePath, filename, title, initialComment, threadTs }, error);
      throw error;
    }
  }
}
