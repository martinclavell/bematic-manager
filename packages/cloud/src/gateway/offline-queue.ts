import { Limits, createLogger, serializeMessage, type WSMessage } from '@bematic/common';
import type { OfflineQueueRepository } from '@bematic/db';
import { AgentManager } from './agent-manager.js';

const logger = createLogger('offline-queue');

export class OfflineQueue {
  constructor(
    private readonly repo: OfflineQueueRepository,
    private readonly agentManager: AgentManager,
  ) {
    // Listen for agent reconnections and drain queue
    this.agentManager.on('agent:connected', (agentId: string) => {
      this.drain(agentId).catch((err) => {
        logger.error({ err, agentId }, 'Failed to drain offline queue');
      });
    });
  }

  enqueue(agentId: string, message: WSMessage): void {
    const expiresAt = new Date(
      Date.now() + Limits.OFFLINE_QUEUE_TTL_MS,
    ).toISOString();

    this.repo.enqueue({
      agentId,
      messageType: message.type,
      payload: JSON.stringify(message),
      expiresAt,
    });

    logger.info({ agentId, messageType: message.type }, 'Message queued for offline agent');
  }

  async drain(agentId: string): Promise<number> {
    const pending = this.repo.findPendingByAgentId(agentId);
    if (pending.length === 0) return 0;

    logger.info({ agentId, count: pending.length }, 'Draining offline queue');

    let delivered = 0;
    for (const item of pending) {
      const sent = this.agentManager.send(agentId, item.payload);
      if (sent) {
        this.repo.markDelivered(item.id);
        delivered++;
      } else {
        logger.warn({ agentId, itemId: item.id }, 'Failed to send queued message');
        break; // Stop if agent disconnected
      }
    }

    logger.info({ agentId, delivered, total: pending.length }, 'Offline queue drained');
    return delivered;
  }

  cleanExpired(): number {
    return this.repo.cleanExpired();
  }
}
