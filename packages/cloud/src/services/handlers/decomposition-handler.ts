import {
  MessageType,
  createLogger,
  generateTaskId,
  createWSMessage,
  serializeMessage,
  type BotPlugin,
  type ParsedCommand,
  type SlackContext,
} from '@bematic/common';
import type { ProjectRow, TaskRepository, AuditLogRepository } from '@bematic/db';
import { ResponseBuilder } from '@bematic/bots';
import { AgentManager } from '../../gateway/agent-manager.js';
import { OfflineQueue } from '../../gateway/offline-queue.js';
import { NotificationService } from '../notification.service.js';
import { SubtaskParser } from './subtask-parser.js';
import { TaskSubmitter } from './task-submitter.js';

const logger = createLogger('decomposition-handler');

interface SubmitParams {
  bot: BotPlugin;
  command: ParsedCommand;
  project: ProjectRow;
  slackContext: SlackContext;
  resumeSessionId?: string | null;
}

/**
 * Handles task decomposition workflow:
 * 1. Submit planning task to Claude (read-only)
 * 2. Parse subtask list from result
 * 3. Submit each subtask as separate task
 */
export class DecompositionHandler {
  private readonly subtaskParser = new SubtaskParser();

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly agentManager: AgentManager,
    private readonly offlineQueue: OfflineQueue,
    private readonly notifier: NotificationService,
    private readonly taskSubmitter: TaskSubmitter,
  ) {}

  /**
   * Submit a task with decomposition
   */
  async submitWithDecomposition(params: SubmitParams): Promise<string> {
    const { bot, command, project, slackContext } = params;

    const decompositionConfig = bot.buildDecompositionConfig(command, {
      name: project.name,
      localPath: project.localPath,
      defaultModel: project.defaultModel,
      defaultMaxBudget: project.defaultMaxBudget,
    });

    if (!decompositionConfig) {
      // Fallback to direct submission if decomposition not supported
      return this.taskSubmitter.submitDirect(params);
    }

    // Create the parent (planning) task
    const parentTaskId = await this.createPlanningTask(project, bot, command, slackContext, decompositionConfig);

    // Notify user that decomposition is happening
    await this.notifier.postMessage(
      slackContext.channelId,
      ':mag: Analyzing task complexity... Breaking into subtasks.',
      slackContext.threadTs,
    );

    // Send planning task to agent
    await this.sendPlanningTask(parentTaskId, project, bot, slackContext, decompositionConfig);

    logger.info(
      { parentTaskId, agentId: project.agentId },
      'Decomposition planning task submitted',
    );

    return parentTaskId;
  }

  /**
   * Called when a planning (decompose) task completes
   * Parses the subtask list and submits each one
   */
  async handlePlanningComplete(
    parentTaskId: string,
    planningResult: string,
    project: ProjectRow,
    bot: BotPlugin,
    slackContext: SlackContext,
  ): Promise<string[]> {
    const subtasks = this.subtaskParser.parse(planningResult);

    if (subtasks.length === 0) {
      return this.fallbackToDirectSubmission(parentTaskId, project, bot, slackContext);
    }

    // Notify user about the subtask breakdown
    await this.notifySubtaskPlan(subtasks, parentTaskId, slackContext);

    // Submit each subtask sequentially (they share the same project dir)
    const subtaskIds = await this.submitSubtasks(subtasks, parentTaskId, project, bot, slackContext);

    logger.info(
      { parentTaskId, subtaskCount: subtaskIds.length, subtaskIds },
      'All subtasks submitted from decomposition',
    );

    return subtaskIds;
  }

  /**
   * Create planning task in database
   */
  private async createPlanningTask(
    project: ProjectRow,
    bot: BotPlugin,
    command: ParsedCommand,
    slackContext: SlackContext,
    decompositionConfig: any,
  ): Promise<string> {
    const parentTaskId = generateTaskId();

    this.taskRepo.create({
      id: parentTaskId,
      projectId: project.id,
      botName: bot.name,
      command: 'decompose',
      prompt: decompositionConfig.prompt,
      status: 'pending',
      slackChannelId: slackContext.channelId,
      slackThreadTs: slackContext.threadTs,
      slackUserId: slackContext.userId,
      slackMessageTs: slackContext.messageTs ?? null,
      maxBudget: decompositionConfig.maxBudget,
    });

    this.auditLogRepo.log('task:created', 'task', parentTaskId, slackContext.userId, {
      botName: bot.name,
      command: 'decompose',
      projectId: project.id,
      isDecomposition: true,
    });

    return parentTaskId;
  }

  /**
   * Send planning task to agent with maxContinuations=0
   */
  private async sendPlanningTask(
    parentTaskId: string,
    project: ProjectRow,
    bot: BotPlugin,
    slackContext: SlackContext,
    decompositionConfig: any,
  ): Promise<void> {
    const wsMsg = createWSMessage(MessageType.TASK_SUBMIT, {
      taskId: parentTaskId,
      projectId: project.id,
      botName: bot.name,
      command: 'decompose',
      prompt: decompositionConfig.prompt,
      systemPrompt: decompositionConfig.systemPrompt,
      localPath: project.localPath,
      model: decompositionConfig.model,
      maxBudget: decompositionConfig.maxBudget,
      allowedTools: decompositionConfig.allowedTools,
      maxContinuations: 0, // Planning should complete in one shot
      parentTaskId: null,
      slackContext: {
        channelId: slackContext.channelId,
        threadTs: slackContext.threadTs,
        userId: slackContext.userId,
      },
    });

    const sent = this.agentManager.send(project.agentId, serializeMessage(wsMsg));

    if (!sent) {
      await this.handleOfflinePlanningTask(parentTaskId, project.agentId, wsMsg, slackContext);
    }
  }

  /**
   * Handle planning task when agent is offline
   */
  private async handleOfflinePlanningTask(
    parentTaskId: string,
    agentId: string,
    wsMsg: any,
    slackContext: SlackContext,
  ): Promise<void> {
    this.offlineQueue.enqueue(agentId, wsMsg);
    this.taskRepo.update(parentTaskId, { status: 'queued' });

    if (slackContext.messageTs) {
      await this.notifier.removeReaction(slackContext.channelId, slackContext.messageTs, 'hourglass_flowing_sand');
      await this.notifier.addReaction(slackContext.channelId, slackContext.messageTs, 'inbox_tray');
    }

    await this.notifier.postBlocks(
      slackContext.channelId,
      ResponseBuilder.queuedOfflineBlocks(parentTaskId),
      'Agent is offline. Task queued.',
      slackContext.threadTs,
    );
  }

  /**
   * Fallback when decomposition returns no subtasks
   */
  private async fallbackToDirectSubmission(
    parentTaskId: string,
    project: ProjectRow,
    bot: BotPlugin,
    slackContext: SlackContext,
  ): Promise<string[]> {
    logger.warn({ parentTaskId }, 'Decomposition returned no subtasks, submitting original task directly');

    const parentTask = this.taskRepo.findById(parentTaskId);
    if (parentTask) {
      const command = bot.parseCommand(parentTask.prompt);
      const taskId = await this.taskSubmitter.submitDirect({
        bot,
        command,
        project,
        slackContext,
      });
      return [taskId];
    }
    return [];
  }

  /**
   * Notify user about subtask breakdown
   */
  private async notifySubtaskPlan(
    subtasks: any[],
    parentTaskId: string,
    slackContext: SlackContext,
  ): Promise<void> {
    const subtaskList = subtasks
      .map((s, i) => `${i + 1}. *${s.title}*`)
      .join('\n');

    await this.notifier.postBlocks(
      slackContext.channelId,
      ResponseBuilder.subtaskPlanBlocks(parentTaskId, subtasks),
      `Breaking into ${subtasks.length} subtasks:\n${subtaskList}`,
      slackContext.threadTs,
    );
  }

  /**
   * Submit all subtasks sequentially
   */
  private async submitSubtasks(
    subtasks: any[],
    parentTaskId: string,
    project: ProjectRow,
    bot: BotPlugin,
    slackContext: SlackContext,
  ): Promise<string[]> {
    const subtaskIds: string[] = [];

    for (const subtask of subtasks) {
      const parsedCommand: ParsedCommand = {
        botName: bot.name,
        command: subtask.command,
        args: subtask.prompt,
        flags: {},
        rawText: subtask.prompt,
      };

      const taskId = await this.taskSubmitter.submitDirect({
        bot,
        command: parsedCommand,
        project,
        slackContext,
        parentTaskId,
      });

      subtaskIds.push(taskId);
    }

    return subtaskIds;
  }
}
