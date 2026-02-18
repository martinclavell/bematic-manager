import { createLogger } from '@bematic/common';

const logger = createLogger('message-buffer');

export interface BufferedMessage {
  id: string;
  agentId: string;
  message: string;
  timestamp: number;
  attempts: number;
}

/**
 * Buffers messages for agents that disconnect temporarily
 * Messages are retained for a short period and replayed on reconnection
 */
export class MessageBuffer {
  private buffers = new Map<string, BufferedMessage[]>();
  private maxBufferSize = 100; // Max messages per agent
  private maxRetentionMs = 300_000; // 5 minutes

  /**
   * Add a message to the buffer for an agent
   */
  buffer(agentId: string, messageId: string, message: string): void {
    let buffer = this.buffers.get(agentId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(agentId, buffer);
    }

    // Check if buffer is full
    if (buffer.length >= this.maxBufferSize) {
      const dropped = buffer.shift();
      logger.warn(
        {
          agentId,
          droppedMessageId: dropped?.id,
          bufferSize: buffer.length,
        },
        'Message buffer full, dropping oldest message',
      );
    }

    buffer.push({
      id: messageId,
      agentId,
      message,
      timestamp: Date.now(),
      attempts: 0,
    });

    logger.debug(
      {
        agentId,
        messageId,
        bufferSize: buffer.length,
      },
      'Message buffered for disconnected agent',
    );
  }

  /**
   * Get all buffered messages for an agent (for replay on reconnect)
   */
  getBuffered(agentId: string): BufferedMessage[] {
    const buffer = this.buffers.get(agentId);
    if (!buffer || buffer.length === 0) {
      return [];
    }

    // Filter out expired messages
    const now = Date.now();
    const valid = buffer.filter((msg) => now - msg.timestamp < this.maxRetentionMs);

    if (valid.length < buffer.length) {
      const expired = buffer.length - valid.length;
      logger.warn(
        {
          agentId,
          expired,
          retained: valid.length,
        },
        'Dropped expired messages from buffer',
      );
    }

    return valid;
  }

  /**
   * Clear buffer for an agent after successful replay
   */
  clear(agentId: string): void {
    const buffer = this.buffers.get(agentId);
    if (buffer && buffer.length > 0) {
      logger.info(
        {
          agentId,
          clearedCount: buffer.length,
        },
        'Cleared message buffer after replay',
      );
      this.buffers.delete(agentId);
    }
  }

  /**
   * Mark a message as attempted (for retry tracking)
   */
  markAttempted(agentId: string, messageId: string): void {
    const buffer = this.buffers.get(agentId);
    if (!buffer) {
      return;
    }

    const msg = buffer.find((m) => m.id === messageId);
    if (msg) {
      msg.attempts++;
    }
  }

  /**
   * Remove a specific message (after successful delivery)
   */
  remove(agentId: string, messageId: string): boolean {
    const buffer = this.buffers.get(agentId);
    if (!buffer) {
      return false;
    }

    const index = buffer.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      buffer.splice(index, 1);
      logger.debug({ agentId, messageId }, 'Message removed from buffer after delivery');

      // Clean up empty buffers
      if (buffer.length === 0) {
        this.buffers.delete(agentId);
      }

      return true;
    }

    return false;
  }

  /**
   * Get buffer statistics for monitoring
   */
  getStats(): {
    totalAgents: number;
    totalMessages: number;
    buffersByAgent: Array<{ agentId: string; messageCount: number; oldestMessageAge: number }>;
  } {
    const buffersByAgent: Array<{
      agentId: string;
      messageCount: number;
      oldestMessageAge: number;
    }> = [];
    let totalMessages = 0;
    const now = Date.now();

    for (const [agentId, buffer] of this.buffers) {
      totalMessages += buffer.length;
      const oldestMessage = buffer[0];
      const oldestAge = oldestMessage ? now - oldestMessage.timestamp : 0;

      buffersByAgent.push({
        agentId,
        messageCount: buffer.length,
        oldestMessageAge: oldestAge,
      });
    }

    return {
      totalAgents: this.buffers.size,
      totalMessages,
      buffersByAgent,
    };
  }

  /**
   * Cleanup expired messages across all agents
   */
  cleanupExpired(): number {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [agentId, buffer] of this.buffers) {
      const before = buffer.length;
      const valid = buffer.filter((msg) => now - msg.timestamp < this.maxRetentionMs);

      if (valid.length < before) {
        const cleaned = before - valid.length;
        totalCleaned += cleaned;

        if (valid.length === 0) {
          this.buffers.delete(agentId);
        } else {
          this.buffers.set(agentId, valid);
        }

        logger.debug(
          {
            agentId,
            cleaned,
            remaining: valid.length,
          },
          'Cleaned expired messages from buffer',
        );
      }
    }

    if (totalCleaned > 0) {
      logger.info({ totalCleaned }, 'Cleaned up expired buffered messages');
    }

    return totalCleaned;
  }
}
