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
} from '@bematic/common';
import type { ProjectRow, TaskRepository, AuditLogRepository, TaskRow } from '@bematic/db';
import { ResponseBuilder } from '@bematic/bots';
import { AgentManager } from '../gateway/agent-manager.js';
import { OfflineQueue } from '../gateway/offline-queue.js';
import { NotificationService } from './notification.service.js';

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

    // Build execution config
    const execConfig = bot.buildExecutionConfig(command, {
      name: project.name,
      localPath: project.localPath,
      defaultModel: project.defaultModel,
      defaultMaxBudget: project.defaultMaxBudget,
    });

    // Append file/image attachment info to the prompt if present
    if (slackContext.fileInfo) {
      execConfig.prompt = execConfig.prompt
        ? `${execConfig.prompt}

${slackContext.fileInfo}`
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
    });

    // Audit log
    this.auditLogRepo.log('task:created', 'task', taskId, slackContext.userId, {
      botName: bot.name,
      command: command.command,
      projectId: project.id,
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
      slackContext: {
        channelId: slackContext.channelId,
        threadTs: slackContext.threadTs,
        userId: slackContext.userId,
      },
    });

    // Send to agent or queue offline
    const sent = this.agentManager.send(project.agentId, serializeMessage(wsMsg));

    if (!sent) {
      // Agent offline - queue message
      this.offlineQueue.enqueue(project.agentId, wsMsg);
      this.taskRepo.update(taskId, { status: 'queued' });

      // Swap hourglass for queued emoji on the user's message
      if (slackContext.messageTs) {
        await this.notifier.removeReaction(slackContext.channelId, slackContext.messageTs, 'hourglass_flowing_sand');
        await this.notifier.addReaction(slackContext.channelId, slackContext.messageTs, 'inbox_tray');
      }

      await this.notifier.postBlocks(
        slackContext.channelId,
        ResponseBuilder.queuedOfflineBlocks(taskId),
        'Agent is offline. Task queued.',
        slackContext.threadTs,
      );

      logger.info({ taskId, agentId: project.agentId }, 'Task queued for offline agent');
    } else {
      logger.info({ taskId, agentId: project.agentId }, 'Task submitted to agent');
    }

    return taskId;
  }

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

    this.auditLogRepo.log('task:cancelled', 'task', taskId, null, { reason });
  }
}
