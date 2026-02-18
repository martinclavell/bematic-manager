import { MessageType, createLogger, parseMessage } from '@bematic/common';
import type { TaskRepository, AuditLogRepository, ProjectRepository } from '@bematic/db';
import type { StreamAccumulator } from './stream-accumulator.js';
import type { NotificationService } from '../services/notification.service.js';
import type { CommandService } from '../services/command.service.js';
import {
  TaskAckHandler,
  TaskProgressHandler,
  TaskStreamHandler,
  TaskCompletionHandler,
  TaskErrorHandler,
  TaskCancelledHandler,
  DeployResultHandler,
} from './handlers/index.js';

const logger = createLogger('message-router');

/**
 * Routes WebSocket messages from agents to appropriate handlers
 *
 * Refactored from 442 lines into focused handler modules for:
 * - Better separation of concerns
 * - Easier testing
 * - Clearer message flow
 */
export class MessageRouter {
  private taskAckHandler: TaskAckHandler;
  private taskProgressHandler: TaskProgressHandler;
  private taskStreamHandler: TaskStreamHandler;
  private taskCompletionHandler: TaskCompletionHandler;
  private taskErrorHandler: TaskErrorHandler;
  private taskCancelledHandler: TaskCancelledHandler;
  private deployResultHandler: DeployResultHandler;

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly streamAccumulator: StreamAccumulator,
    private readonly notifier: NotificationService,
  ) {
    // Initialize all handlers
    this.taskAckHandler = new TaskAckHandler(taskRepo);
    this.taskProgressHandler = new TaskProgressHandler(taskRepo, notifier);
    this.taskStreamHandler = new TaskStreamHandler(taskRepo, streamAccumulator);
    this.taskCompletionHandler = new TaskCompletionHandler(taskRepo, auditLogRepo, notifier);
    this.taskErrorHandler = new TaskErrorHandler(taskRepo, auditLogRepo, notifier);
    this.taskCancelledHandler = new TaskCancelledHandler(taskRepo, auditLogRepo, notifier);
    this.deployResultHandler = new DeployResultHandler(auditLogRepo, notifier);
  }

  /**
   * Inject CommandService after construction (avoids circular dependency)
   * Required for decomposition handling
   */
  setCommandService(commandService: CommandService, projectRepo: ProjectRepository): void {
    this.taskCompletionHandler.setCommandService(commandService, projectRepo);
  }

  /**
   * Register a deploy request so we know where to post the result
   */
  registerDeployRequest(
    requestId: string,
    channelId: string,
    threadTs: string | null,
    userId: string,
  ): void {
    this.deployResultHandler.registerDeployRequest(requestId, channelId, threadTs, userId);
  }

  /**
   * Main entry point - routes agent messages to appropriate handlers
   */
  async handleAgentMessage(agentId: string, raw: string): Promise<void> {
    const msg = parseMessage(raw);

    try {
      switch (msg.type) {
        case MessageType.TASK_ACK:
          await this.taskAckHandler.handle(msg.payload);
          break;

        case MessageType.TASK_PROGRESS:
          await this.taskProgressHandler.handle(msg.payload);
          break;

        case MessageType.TASK_STREAM:
          this.taskStreamHandler.handle(msg.payload);
          break;

        case MessageType.TASK_COMPLETE:
          await this.taskCompletionHandler.handle(agentId, msg.payload);
          // Clean up trackers
          const taskId = (msg.payload as any).taskId;
          this.taskProgressHandler.cleanup(taskId);
          this.taskStreamHandler.cleanup(taskId);
          break;

        case MessageType.TASK_ERROR:
          await this.taskErrorHandler.handle(agentId, msg.payload);
          break;

        case MessageType.TASK_CANCELLED:
          await this.taskCancelledHandler.handle(msg.payload);
          break;

        case MessageType.DEPLOY_RESULT:
          await this.deployResultHandler.handle(agentId, msg.payload as any);
          break;

        case MessageType.AGENT_STATUS:
          logger.debug({ agentId, payload: msg.payload }, 'Agent status update');
          break;

        default:
          logger.warn({ type: msg.type, agentId }, 'Unknown message type from agent');
      }
    } catch (error) {
      logger.error(
        { error, messageType: msg.type, agentId },
        'Error handling agent message',
      );
    }
  }
}
