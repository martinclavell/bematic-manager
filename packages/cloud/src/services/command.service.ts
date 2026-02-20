import {
  MessageType,
  createLogger,
  generateTaskId,
  createWSMessage,
  serializeMessage,
  type BotName,
  type BotPlugin,
  type ParsedCommand,
  type SlackContext,
  type SubtaskDefinition,
} from '@bematic/common';
import type { ProjectRow, TaskRepository, AuditLogRepository, TaskRow } from '@bematic/db';
import { ResponseBuilder, BotRegistry } from '@bematic/bots';
import { AgentManager } from '../gateway/agent-manager.js';
import { OfflineQueue } from '../gateway/offline-queue.js';
import { NotificationService } from './notification.service.js';
import { metrics, MetricNames } from '../utils/metrics.js';

const logger = createLogger('command-service');

interface SubmitParams {
  bot: BotPlugin;
  command: ParsedCommand;
  project: ProjectRow;
  slackContext: SlackContext;
  resumeSessionId?: string | null;
}

export class CommandService {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly agentManager: AgentManager,
    private readonly offlineQueue: OfflineQueue,
    private readonly notifier: NotificationService,
  ) {}

  async submit(params: SubmitParams): Promise<string> {
    const { bot, command, project, slackContext } = params;

    // Check if this task should be decomposed into subtasks
    if (bot.shouldDecompose(command)) {
      return this.submitWithDecomposition(params);
    }

    return this.submitDirect(params);
  }

  /** Submit a task directly to the agent (no decomposition) */
  private async submitDirect(params: SubmitParams, parentTaskId?: string): Promise<string> {
    const { bot, command, project, slackContext } = params;

    // Build execution config
    const execConfig = bot.buildExecutionConfig(command, {
      name: project.name,
      localPath: project.localPath,
      defaultModel: project.defaultModel,
      defaultMaxBudget: project.defaultMaxBudget,
      channelId: slackContext.channelId,
      channelName: undefined, // TODO: Fetch from Slack API if needed
    });

    // Append file description to the prompt if attachments were downloaded
    if (slackContext.fileInfo) {
      execConfig.prompt = execConfig.prompt
        ? `${execConfig.prompt}\n\n${slackContext.fileInfo}`
        : slackContext.fileInfo;
      logger.info({ fileInfo: slackContext.fileInfo.slice(0, 200) }, 'Appended file info to prompt');
    }

    // Create task in DB
    const taskId = generateTaskId();
    this.taskRepo.create({
      id: taskId,
      projectId: project.id,
      botName: bot.name,
      command: command.command,
      prompt: execConfig.prompt,
      status: 'pending',
      slackChannelId: slackContext.channelId,
      slackThreadTs: slackContext.threadTs,
      slackUserId: slackContext.userId,
      slackMessageTs: slackContext.messageTs ?? null,
      maxBudget: execConfig.maxBudget,
      parentTaskId: parentTaskId ?? null,
    });

    // Track metrics for task submission
    metrics.increment(MetricNames.TASKS_SUBMITTED);
    metrics.gauge(MetricNames.ACTIVE_TASKS, this.taskRepo.findActiveByProjectId('').length);

    // Audit log
    this.auditLogRepo.log('task:created', 'task', taskId, slackContext.userId, {
      botName: bot.name,
      command: command.command,
      projectId: project.id,
      parentTaskId: parentTaskId ?? null,
    });

    // Build WS message
    const wsMsg = createWSMessage(MessageType.TASK_SUBMIT, {
      taskId,
      projectId: project.id,
      botName: bot.name,
      command: command.command,
      prompt: execConfig.prompt,
      systemPrompt: execConfig.systemPrompt,
      localPath: project.localPath,
      model: execConfig.model,
      maxBudget: execConfig.maxBudget,
      allowedTools: execConfig.allowedTools,
      resumeSessionId: params.resumeSessionId ?? null,
      parentTaskId: parentTaskId ?? null,
      attachments: slackContext.attachments?.length ? slackContext.attachments : undefined,
      slackContext: {
        channelId: slackContext.channelId,
        threadTs: slackContext.threadTs,
        userId: slackContext.userId,
      },
    });

    // Send to agent (auto-resolve to any available agent)
    const connectedAgents = this.agentManager.getConnectedAgentIds();
    logger.info(
      { taskId, preferredAgent: project.agentId, connectedAgents, connectedCount: connectedAgents.length },
      'Resolving agent for task',
    );

    const resolvedAgentId = this.agentManager.resolveAndSend(project.agentId, serializeMessage(wsMsg));

    if (!resolvedAgentId) {
      // No agents available - queue message
      this.offlineQueue.enqueue(project.agentId, wsMsg);
      this.taskRepo.update(taskId, { status: 'queued' });

      // Swap hourglass for queued emoji on the user's message (only for root tasks)
      if (!parentTaskId && slackContext.messageTs) {
        await this.notifier.removeReaction(slackContext.channelId, slackContext.messageTs, 'hourglass_flowing_sand');
        await this.notifier.addReaction(slackContext.channelId, slackContext.messageTs, 'inbox_tray');
      }

      if (!parentTaskId) {
        await this.notifier.postBlocks(
          slackContext.channelId,
          ResponseBuilder.queuedOfflineBlocks(taskId),
          'No agents online. Task queued.',
          slackContext.threadTs,
        );
      }

      logger.info({ taskId, preferredAgent: project.agentId, parentTaskId }, 'Task queued — no agents available');
    } else {
      logger.info({ taskId, agentId: resolvedAgentId, preferredAgent: project.agentId, parentTaskId }, 'Task submitted to agent');
    }

    return taskId;
  }

  /**
   * Submit a task with decomposition:
   * 1. Send a lightweight planning task to Claude (read-only)
   * 2. Parse the subtask list from the result
   * 3. Submit each subtask as a separate task
   */
  private async submitWithDecomposition(params: SubmitParams): Promise<string> {
    const { bot, command, project, slackContext } = params;

    const decompositionConfig = bot.buildDecompositionConfig(command, {
      name: project.name,
      localPath: project.localPath,
      defaultModel: project.defaultModel,
      defaultMaxBudget: project.defaultMaxBudget,
      channelId: slackContext.channelId,
      channelName: undefined, // TODO: Fetch from Slack API if needed
    });

    if (!decompositionConfig) {
      // Fallback to direct submission if decomposition not supported
      return this.submitDirect(params);
    }

    // Create the parent (planning) task
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

    // Track metrics for decomposition task submission
    metrics.increment(MetricNames.TASKS_SUBMITTED);
    metrics.gauge(MetricNames.ACTIVE_TASKS, this.taskRepo.findActiveByProjectId('').length);

    this.auditLogRepo.log('task:created', 'task', parentTaskId, slackContext.userId, {
      botName: bot.name,
      command: 'decompose',
      projectId: project.id,
      isDecomposition: true,
    });

    // Notify user that decomposition is happening
    await this.notifier.postMessage(
      slackContext.channelId,
      ':mag: Analyzing task complexity... Breaking into subtasks.',
      slackContext.threadTs,
    );

    // Send planning task to agent with maxContinuations=0 (no need to continue planning)
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

    const resolvedAgentId = this.agentManager.resolveAndSend(project.agentId, serializeMessage(wsMsg));

    if (!resolvedAgentId) {
      this.offlineQueue.enqueue(project.agentId, wsMsg);
      this.taskRepo.update(parentTaskId, { status: 'queued' });

      if (slackContext.messageTs) {
        await this.notifier.removeReaction(slackContext.channelId, slackContext.messageTs, 'hourglass_flowing_sand');
        await this.notifier.addReaction(slackContext.channelId, slackContext.messageTs, 'inbox_tray');
      }

      await this.notifier.postBlocks(
        slackContext.channelId,
        ResponseBuilder.queuedOfflineBlocks(parentTaskId),
        'No agents online. Task queued.',
        slackContext.threadTs,
      );
    }

    logger.info(
      { parentTaskId, agentId: resolvedAgentId, preferredAgent: project.agentId },
      'Decomposition planning task submitted',
    );

    return parentTaskId;
  }

  /**
   * Called by MessageRouter when a planning (decompose) task completes.
   * Parses the subtask list and submits each one.
   */
  async handleDecompositionComplete(
    parentTaskId: string,
    planningResult: string,
    project: ProjectRow,
    bot: BotPlugin,
    slackContext: SlackContext,
  ): Promise<string[]> {
    const subtasks = this.parseSubtasks(planningResult);

    if (subtasks.length === 0) {
      logger.warn({ parentTaskId }, 'Decomposition returned no subtasks, submitting original task directly');

      // Fall back to the parent task's original prompt as a direct submission
      const parentTask = this.taskRepo.findById(parentTaskId);
      if (parentTask) {
        const command = bot.parseCommand(parentTask.prompt);
        return [await this.submitDirect({
          bot,
          command,
          project,
          slackContext,
        })];
      }
      return [];
    }

    // Notify user about the subtask breakdown
    const subtaskList = subtasks
      .map((s, i) => `${i + 1}. *${s.title}*`)
      .join('\n');

    await this.notifier.postBlocks(
      slackContext.channelId,
      ResponseBuilder.subtaskPlanBlocks(parentTaskId, subtasks),
      `Breaking into ${subtasks.length} subtasks:\n${subtaskList}`,
      slackContext.threadTs,
    );

    // Submit each subtask sequentially (they share the same project dir)
    const subtaskIds: string[] = [];
    for (const subtask of subtasks) {
      const parsedCommand: ParsedCommand = {
        botName: bot.name,
        command: subtask.command,
        args: subtask.prompt,
        flags: {},
        rawText: subtask.prompt,
      };

      const taskId = await this.submitDirect(
        {
          bot,
          command: parsedCommand,
          project,
          slackContext,
        },
        parentTaskId,
      );

      subtaskIds.push(taskId);
    }

    logger.info(
      { parentTaskId, subtaskCount: subtaskIds.length, subtaskIds },
      'All subtasks submitted from decomposition',
    );

    return subtaskIds;
  }

  /** Parse subtasks from a planning result text */
  private parseSubtasks(result: string): SubtaskDefinition[] {
    try {
      // Look for JSON block with the ```json:subtasks marker
      const jsonMatch = result.match(/```json:subtasks\s*\n([\s\S]*?)```/);
      if (jsonMatch?.[1]) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is SubtaskDefinition =>
              typeof item.title === 'string' &&
              typeof item.prompt === 'string' &&
              typeof item.command === 'string',
          );
        }
      }

      // Fallback: try to find any JSON array in the result
      const arrayMatch = result.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (item): item is SubtaskDefinition =>
              typeof item.title === 'string' &&
              typeof item.prompt === 'string' &&
              typeof item.command === 'string',
          );
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to parse subtasks from planning result');
    }

    return [];
  }

  async resubmit(task: TaskRow, project: ProjectRow): Promise<string> {
    // Reconstruct bot config so retry uses the same system prompt and tools
    const bot = BotRegistry.get(task.botName as BotName);
    const command: ParsedCommand = bot?.parseCommand(task.prompt) ?? {
      botName: task.botName as BotName,
      command: task.command,
      args: task.prompt,
      flags: {},
      rawText: task.prompt,
    };
    const execConfig = bot?.buildExecutionConfig(command, {
      name: project.name,
      localPath: project.localPath,
      defaultModel: project.defaultModel,
      defaultMaxBudget: project.defaultMaxBudget,
      channelId: task.slackChannelId,
      channelName: undefined, // TODO: Fetch from Slack API if needed
    });

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

    // Track metrics for continued task submission
    metrics.increment(MetricNames.TASKS_SUBMITTED);
    metrics.gauge(MetricNames.ACTIVE_TASKS, this.taskRepo.findActiveByProjectId('').length);

    // Resume the previous Claude session if one exists
    const resumeSessionId = task.sessionId ?? null;

    const wsMsg = createWSMessage(MessageType.TASK_SUBMIT, {
      taskId,
      projectId: task.projectId,
      botName: task.botName as BotName,
      command: task.command,
      prompt: task.prompt,
      systemPrompt: execConfig?.systemPrompt ?? '',
      localPath: project.localPath,
      model: execConfig?.model ?? project.defaultModel,
      maxBudget: task.maxBudget,
      allowedTools: execConfig?.allowedTools ?? [],
      resumeSessionId,
      slackContext: {
        channelId: task.slackChannelId,
        threadTs: task.slackThreadTs,
        userId: task.slackUserId,
      },
    });

    const connectedAgents = this.agentManager.getConnectedAgentIds();
    logger.info(
      { taskId, originalTaskId: task.id, resumeSessionId, connectedAgents: connectedAgents.length },
      'Resubmitting task (retry)',
    );

    const resolvedAgentId = this.agentManager.resolveAndSend(project.agentId, serializeMessage(wsMsg));
    if (!resolvedAgentId) {
      this.offlineQueue.enqueue(project.agentId, wsMsg);
      this.taskRepo.update(taskId, { status: 'queued' });
    }

    return taskId;
  }

  async cancel(taskId: string, reason: string): Promise<void> {
    const task = this.taskRepo.findById(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const project = (await import('@bematic/db')).getDatabase()
      ? undefined
      : undefined; // Not needed - we get agentId from project

    // Find the project's agent
    const projectRow = this.taskRepo.findById(taskId);
    if (!projectRow) return;

    const cancelMsg = createWSMessage(MessageType.TASK_CANCEL, {
      taskId,
      reason,
    });

    // Try to find project to get agentId
    // For simplicity, broadcast cancel to all agents
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
