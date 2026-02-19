import { Limits, createLogger, MessageType, type WSMessage } from '@bematic/common';
import type { OfflineQueueRepository, TaskRepository } from '@bematic/db';
import { AgentManager } from './agent-manager.js';
import { NotificationService } from '../services/notification.service.js';
import type { Config } from '../config.js';

const logger = createLogger('offline-queue');

interface DeliveryMetrics {
  totalMessages: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  avgDeliveryTimeMs: number;
  throughputMsgsPerSec: number;
}

interface DeliveryResult {
  success: boolean;
  itemId: number;
  error?: Error;
  deliveryTimeMs: number;
}

export class OfflineQueue {
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private deliveryMetrics: DeliveryMetrics = {
    totalMessages: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    avgDeliveryTimeMs: 0,
    throughputMsgsPerSec: 0,
  };

  constructor(
    private readonly repo: OfflineQueueRepository,
    private readonly agentManager: AgentManager,
    private readonly config: Config,
    private readonly taskRepo?: TaskRepository,
    private readonly notifier?: NotificationService,
  ) {
    // Listen for agent reconnections and drain the entire queue
    this.agentManager.on('agent:connected', (agentId: string) => {
      logger.info({ agentId }, 'Agent connected — draining all pending queue entries');
      this.drainAll().catch((err) => {
        logger.error({ err, agentId }, 'Failed to drain offline queue on agent connect');
      });
    });
  }

  /** Start a periodic drain that catches anything missed by event-based drains */
  startPeriodicDrain(intervalMs: number = 30_000): void {
    if (this.drainTimer) return;
    this.drainTimer = setInterval(() => {
      const connectedAgents = this.agentManager.getConnectedAgentIds();
      if (connectedAgents.length === 0) return;

      this.drainAll().catch((err) => {
        logger.error({ err }, 'Failed periodic offline queue drain');
      });
    }, intervalMs);
  }

  stopPeriodicDrain(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
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

  /**
   * Drain ALL pending entries with parallel processing support.
   * Processes messages in batches with configurable concurrency.
   */
  async drainAll(): Promise<number> {
    const startTime = Date.now();
    const pending = this.repo.findAllPending();
    if (pending.length === 0) return 0;

    logger.info({
      count: pending.length,
      concurrency: this.config.offlineQueue.maxConcurrentDeliveries,
      preserveOrder: this.config.offlineQueue.preserveMessageOrder
    }, 'Draining all pending offline queue entries');

    let totalDelivered = 0;

    if (this.config.offlineQueue.preserveMessageOrder) {
      // Process sequentially to maintain order
      totalDelivered = await this.drainSequentially(pending);
    } else {
      // Process in parallel batches
      totalDelivered = await this.drainInParallel(pending);
    }

    // Update metrics
    const totalTime = Date.now() - startTime;
    this.updateMetrics(pending.length, totalDelivered, totalTime);

    logger.info({
      delivered: totalDelivered,
      total: pending.length,
      durationMs: totalTime,
      throughputMsgsPerSec: this.deliveryMetrics.throughputMsgsPerSec.toFixed(2)
    }, 'Offline queue drain complete');

    return totalDelivered;
  }

  /**
   * Process messages sequentially to preserve order
   */
  private async drainSequentially(messages: any[]): Promise<number> {
    let delivered = 0;

    for (const item of messages) {
      const result = await this.deliverMessage(item);
      if (result.success) {
        delivered++;
      } else {
        // Stop on first failure to preserve order
        logger.warn({ itemId: item.id }, 'Sequential processing stopped due to delivery failure');
        break;
      }
    }

    return delivered;
  }

  /**
   * Process messages in parallel batches
   */
  private async drainInParallel(messages: any[]): Promise<number> {
    const batchSize = this.config.offlineQueue.maxConcurrentDeliveries;
    let totalDelivered = 0;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      logger.debug({
        batchIndex: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
        startIndex: i
      }, 'Processing batch');

      const batchPromises = batch.map(item => this.deliverMessage(item));
      const results = await Promise.allSettled(batchPromises);

      let batchDelivered = 0;
      let batchFailed = 0;

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.success) {
          batchDelivered++;
        } else {
          batchFailed++;
          const item = batch[index];
          const error = result.status === 'rejected' ? result.reason : result.value.error;
          logger.warn({
            itemId: item.id,
            error: error?.message || 'Unknown error'
          }, 'Batch delivery failed');
        }
      });

      totalDelivered += batchDelivered;

      logger.debug({
        batchDelivered,
        batchFailed,
        batchTotal: batch.length
      }, 'Batch processing complete');
    }

    return totalDelivered;
  }

  /**
   * Deliver a single message with retry logic and timeout
   */
  private async deliverMessage(item: any): Promise<DeliveryResult> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.config.offlineQueue.retryAttempts; attempt++) {
      try {
        const result = await this.attemptDelivery(item);
        const deliveryTime = Date.now() - startTime;

        if (result) {
          return {
            success: true,
            itemId: item.id,
            deliveryTimeMs: deliveryTime
          };
        } else {
          lastError = new Error('Delivery failed - no available agent');
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug({
          itemId: item.id,
          attempt: attempt + 1,
          error: lastError.message
        }, 'Delivery attempt failed');

        // Wait before retry (except on last attempt)
        if (attempt < this.config.offlineQueue.retryAttempts - 1) {
          await this.sleep(this.config.offlineQueue.retryDelayMs * (attempt + 1));
        }
      }
    }

    const deliveryTime = Date.now() - startTime;
    return {
      success: false,
      itemId: item.id,
      error: lastError,
      deliveryTimeMs: deliveryTime
    };
  }

  /**
   * Attempt to deliver a message with timeout
   */
  private async attemptDelivery(item: any): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Delivery timeout after ${this.config.offlineQueue.deliveryTimeout}ms`));
      }, this.config.offlineQueue.deliveryTimeout);

      try {
        // Use the item's original agentId as preferred, with fallback to any agent
        const targetAgentId = this.agentManager.resolveAgent(item.agentId);
        if (!targetAgentId) {
          clearTimeout(timeout);
          resolve(false);
          return;
        }

        const sent = this.agentManager.send(targetAgentId, item.payload);
        clearTimeout(timeout);

        if (sent) {
          this.repo.markDelivered(item.id);
          logger.debug(
            { itemId: item.id, queuedAgentId: item.agentId, targetAgentId },
            'Queued message delivered',
          );

          // Update Slack and task status for TASK_SUBMIT messages
          this.handleTaskDelivery(item.payload).catch(err => {
            logger.warn({ err, itemId: item.id }, 'Failed to update Slack after task delivery');
          });

          resolve(true);
        } else {
          resolve(false);
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /**
   * Update delivery metrics
   */
  private updateMetrics(total: number, delivered: number, durationMs: number): void {
    this.deliveryMetrics.totalMessages += total;
    this.deliveryMetrics.successfulDeliveries += delivered;
    this.deliveryMetrics.failedDeliveries += (total - delivered);

    // Update average delivery time (weighted average)
    const newAvgTime = durationMs / total;
    this.deliveryMetrics.avgDeliveryTimeMs =
      (this.deliveryMetrics.avgDeliveryTimeMs + newAvgTime) / 2;

    // Calculate throughput (messages per second)
    this.deliveryMetrics.throughputMsgsPerSec =
      durationMs > 0 ? (delivered / durationMs) * 1000 : 0;
  }

  /**
   * Get current delivery metrics
   */
  getMetrics(): DeliveryMetrics {
    return { ...this.deliveryMetrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.deliveryMetrics = {
      totalMessages: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      avgDeliveryTimeMs: 0,
      throughputMsgsPerSec: 0,
    };
  }

  /**
   * Handle post-delivery updates for TASK_SUBMIT messages
   */
  private async handleTaskDelivery(payload: string): Promise<void> {
    if (!this.taskRepo || !this.notifier) {
      return; // Dependencies not available
    }

    try {
      const message = JSON.parse(payload) as WSMessage;

      // Only handle TASK_SUBMIT messages
      if (message.type !== MessageType.TASK_SUBMIT) {
        return;
      }

      const taskPayload = message.payload as any;
      const taskId = taskPayload.taskId;
      const slackContext = taskPayload.slackContext;

      if (!taskId || !slackContext) {
        return;
      }

      // Update task status from 'queued' to 'pending'
      this.taskRepo.update(taskId, { status: 'pending' });

      // Get task to check if it's a root task (no parentTaskId)
      const task = this.taskRepo.findById(taskId);
      if (!task || task.parentTaskId) {
        return; // Skip Slack updates for subtasks
      }

      const messageTs = slackContext.messageTs || task.slackMessageTs;
      if (!messageTs) {
        return; // No message to update
      }

      // Swap inbox_tray back to hourglass
      await this.notifier.removeReaction(slackContext.channelId, messageTs, 'inbox_tray');
      await this.notifier.addReaction(slackContext.channelId, messageTs, 'hourglass_flowing_sand');

      // Update the "Agent is offline" message to "Agent is back online"
      // Find and update the queued message by searching recent messages in the thread
      await this.notifier.updateQueuedMessage(
        slackContext.channelId,
        slackContext.threadTs,
        taskId,
      );

      logger.info({ taskId }, 'Updated Slack after delivering queued task');
    } catch (error) {
      logger.warn({ error, payload: payload.slice(0, 100) }, 'Failed to parse queued message for Slack update');
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  cleanExpired(): number {
    return this.repo.cleanExpired();
  }
}
