import { createLogger, type SlackBlock } from '@bematic/common';

type WebClient = import('@slack/bolt').App['client'];

const logger = createLogger('notification');

export class NotificationService {
  constructor(private readonly client: WebClient) {}

  async postMessage(
    channel: string,
    text: string,
    threadTs?: string | null,
  ): Promise<string | undefined> {
    try {
      const result = await this.client.chat.postMessage({
        channel,
        text,
        thread_ts: threadTs ?? undefined,
      });
      return result.ts;
    } catch (error) {
      logger.error({ error, channel }, 'Failed to post Slack message');
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
      const result = await this.client.chat.postMessage({
        channel,
        blocks: blocks as any[],
        text: fallbackText,
        thread_ts: threadTs ?? undefined,
      });
      return result.ts;
    } catch (error) {
      logger.error({ error, channel }, 'Failed to post Slack blocks');
      return undefined;
    }
  }

  async updateMessage(
    channel: string,
    text: string,
    messageTs: string,
  ): Promise<string | null> {
    try {
      const result = await this.client.chat.update({
        channel,
        ts: messageTs,
        text,
      });
      return result.ts ?? null;
    } catch (error) {
      logger.error({ error, channel, messageTs }, 'Failed to update Slack message');
      return null;
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
}
