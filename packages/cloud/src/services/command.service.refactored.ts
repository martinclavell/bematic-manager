import {
  createLogger,
  generateTaskId,
  createWSMessage,
  serializeMessage,
  MessageType,
  type BotPlugin,
  type ParsedCommand,
  type SlackContext,
  type BotName,
} from '@bematic/common';
import type { ProjectRow, TaskRepository, AuditLogRepository, TaskRow } from '@bematic/db';
import { AgentManager } from '../gateway/agent-manager.js';
import { OfflineQueue } from '../gateway/offline-queue.js';
import { NotificationService } from './notification.service.js';
import { TaskSubmitter, DecompositionHandler } from './handlers/index.js';

const logger = createLogger('command-service');

interface SubmitParams {
  bot: BotPlugin;
  command: ParsedCommand;
  project: ProjectRow;
  slackContext: SlackContext;
  resumeSessionId?: string | null;
}

/**
 * Orchestrates task submission with optional decomposition
 *
 * Refactored from 444 lines into focused modules:
 * - TaskSubmitter: Direct task submission
 * - DecompositionHandler: Planning & subtask submission
 * - SubtaskParser: JSON parsing logic
 */
export class CommandService {
  private readonly taskSubmitter: TaskSubmitter;
  private readonly decompositionHandler: DecompositionHandler;

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly agentManager: AgentManager,
    private readonly offlineQueue: OfflineQueue,
    private readonly notifier: NotificationService,
  ) {
    // Initialize handlers
    this.taskSubmitter = new TaskSubmitter(
      taskRepo,
      auditLogRepo,
      agentManager,
      offlineQueue,
      notifier,
    );

    this.decompositionHandler = new DecompositionHandler(
      taskRepo,
      auditLogRepo,
      agentManager,
      offlineQueue,
      notifier,
      this.taskSubmitter,
    );
  }

  /**
   * Main entry point - submits task with optional decomposition
   */
  async submit(params: SubmitParams): Promise<string> {
    const { bot, command } = params;

    // Check if this task should be decomposed into subtasks
    if (bot.shouldDecompose(command)) {
      return this.decompositionHandler.submitWithDecomposition(params);
    }

    return this.taskSubmitter.submitDirect(params);
  }

  /**
   * Called by MessageRouter when a planning (decompose) task completes
   * Delegates to DecompositionHandler
   */
  async handleDecompositionComplete(
    parentTaskId: string,
    planningResult: string,
    project: ProjectRow,
    bot: BotPlugin,
    slackContext: SlackContext,
  ): Promise<string[]> {
    return this.decompositionHandler.handlePlanningComplete(
      parentTaskId,
      planningResult,
      project,
      bot,
      slackContext,
    );
  }

  /**
   * Resubmit a failed/cancelled task
   */
  async resubmit(task: TaskRow, project: ProjectRow): Promise<string> {
    // Create a new task based on the old one
    const taskId = generateTaskId();
    this.taskRepo.create({
      id: taskId,
      projectId: task.projectId,
      botName: task.botName,
      command: task.command,
      prompt: task.prompt,
      status: 'pending',
      slackChannelId: task.slackChannelId,
      slackThreadTs: task.slackThreadTs,
      slackUserId: task.slackUserId,
      maxBudget: task.maxBudget,
    });

    // Re-send to agent
    const wsMsg = createWSMessage(MessageType.TASK_SUBMIT, {
      taskId,
      projectId: task.projectId,
      botName: task.botName as BotName,
      command: task.command,
      prompt: task.prompt,
      systemPrompt: '', // Will use default from bot
      localPath: project.localPath,
      model: project.defaultModel,
      maxBudget: task.maxBudget,
      allowedTools: [],
      slackContext: {
        channelId: task.slackChannelId,
        threadTs: task.slackThreadTs,
        userId: task.slackUserId,
      },
    });

    const sent = this.agentManager.send(project.agentId, serializeMessage(wsMsg));
    if (!sent) {
      this.offlineQueue.enqueue(project.agentId, wsMsg);
      this.taskRepo.update(taskId, { status: 'queued' });
    }

    return taskId;
  }

  /**
   * Cancel a task and all its subtasks
   */
  async cancel(taskId: string, reason: string): Promise<void> {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const cancelMsg = createWSMessage(MessageType.TASK_CANCEL, {
      taskId,
      reason,
    });

    // Broadcast cancel to all connected agents
    for (const agentId of this.agentManager.getConnectedAgentIds()) {
      this.agentManager.send(agentId, serializeMessage(cancelMsg));
    }

    this.taskRepo.update(taskId, { status: 'cancelled' });

    // Also cancel any child subtasks
    const subtasks = this.taskRepo.findByParentTaskId(taskId);
    for (const subtask of subtasks) {
      if (subtask.status === 'pending' || subtask.status === 'running' || subtask.status === 'queued') {
        const childCancelMsg = createWSMessage(MessageType.TASK_CANCEL, {
          taskId: subtask.id,
          reason: `Parent task ${taskId} cancelled: ${reason}`,
        });
        for (const agentId of this.agentManager.getConnectedAgentIds()) {
          this.agentManager.send(agentId, serializeMessage(childCancelMsg));
        }
        this.taskRepo.update(subtask.id, { status: 'cancelled' });
      }
    }

    this.auditLogRepo.log('task:cancelled', 'task', taskId, null, { reason });
  }
}
