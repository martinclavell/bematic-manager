import { createLogger } from '@bematic/common';
import { markdownToSlack } from '../utils/markdown-to-slack.js';

const logger = createLogger('stream-accumulator');

interface StreamState {
  taskId: string;
  buffer: string;
  lastUpdate: number;
  slackChannelId: string;
  slackThreadTs: string | null;
  slackMessageTs: string | null; // The ts of the message we're updating
}

/**
 * Batches text deltas from agent streams and updates Slack
 * messages at a configurable interval to avoid rate limits.
 */
export class StreamAccumulator {
  private streams = new Map<string, StreamState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly updateIntervalMs: number,
    private readonly updateSlack: (
      channelId: string,
      text: string,
      threadTs: string | null,
      messageTs: string | null,
    ) => Promise<string | null>, // Returns message ts
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.updateIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final flush
    this.flush();
  }

  addDelta(
    taskId: string,
    delta: string,
    slackChannelId: string,
    slackThreadTs: string | null,
  ): void {
    let state = this.streams.get(taskId);
    if (!state) {
      state = {
        taskId,
        buffer: '',
        lastUpdate: 0,
        slackChannelId,
        slackThreadTs,
        slackMessageTs: null,
      };
      this.streams.set(taskId, state);
    }
    state.buffer += delta;
  }

  removeStream(taskId: string): void {
    this.streams.delete(taskId);
  }

  private flush(): void {
    for (const [taskId, state] of this.streams) {
      if (state.buffer.length === 0) continue;

      const text = state.buffer;
      // Convert markdown to Slack format and truncate if needed
      const converted = markdownToSlack(text);
      const snapshot = converted.length > 3900
        ? '...' + converted.slice(-3900)
        : converted;

      this.updateSlack(
        state.slackChannelId,
        snapshot,
        state.slackThreadTs,
        state.slackMessageTs,
      )
        .then((messageTs) => {
          if (messageTs) {
            state.slackMessageTs = messageTs;
          }
          state.lastUpdate = Date.now();
        })
        .catch((error) => {
          logger.error({ error, taskId }, 'Failed to update Slack');
        });
    }
  }
}
