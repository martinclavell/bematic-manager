import { createLogger, type SlackBlock } from '@bematic/common';
import { withSlackRetry, FailedNotificationQueue } from '../utils/slack-retry.js';

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
      return result.ts;
    } catch (error) {
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
      return result.ts;
    } catch (error) {
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
}
