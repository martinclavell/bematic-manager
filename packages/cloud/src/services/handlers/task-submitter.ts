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
import type { GlobalContextService } from '../global-context.service.js';

const logger = createLogger('task-submitter');

interface SubmitDirectParams {
  bot: BotPlugin;
  command: ParsedCommand;
  project: ProjectRow;
  slackContext: SlackContext;
  resumeSessionId?: string | null;
  parentTaskId?: string;
}

/**
 * Handles direct task submission to agents
 * Responsibilities:
 * - Create task in database
 * - Build WebSocket message
 * - Send to agent or queue if offline
 * - Update Slack reactions
 */
export class TaskSubmitter {
  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly agentManager: AgentManager,
    private readonly offlineQueue: OfflineQueue,
    private readonly notifier: NotificationService,
    private readonly globalContextService: GlobalContextService,
  ) {}

  /**
   * Submit a task directly to the agent (no decomposition)
   */
  async submitDirect(params: SubmitDirectParams): Promise<string> {
    const { bot, command, project, slackContext, resumeSessionId, parentTaskId } = params;

    // Build execution config
    const execConfig = bot.buildExecutionConfig(command, {
      name: project.name,
      localPath: project.localPath,
      defaultModel: project.defaultModel,
      defaultMaxBudget: project.defaultMaxBudget,
    });

    // Inject global context into system prompt
    const globalContext = this.globalContextService.buildGlobalPrompt(project.id);
    if (globalContext) {
      execConfig.systemPrompt = `${globalContext}\n\n---\n\n${execConfig.systemPrompt}`;
      logger.info(
        {
          taskId: 'pre-creation',
          projectId: project.id,
          globalContextLength: globalContext.length
        },
        'Injected global context into system prompt'
      );
    }

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
      parentTaskId: parentTaskId ?? null,
    });

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
      resumeSessionId: resumeSessionId ?? null,
      parentTaskId: parentTaskId ?? null,
      autoCommitPush: project.autoCommitPush ?? false,
      slackContext: {
        channelId: slackContext.channelId,
        threadTs: slackContext.threadTs,
        userId: slackContext.userId,
      },
    });

    // Send to agent or queue offline
    const sent = this.agentManager.send(project.agentId, serializeMessage(wsMsg));

    if (!sent) {
      await this.handleOfflineAgent(taskId, project.agentId, wsMsg, slackContext, parentTaskId);
    } else {
      logger.info({ taskId, agentId: project.agentId, parentTaskId }, 'Task submitted to agent');
    }

    return taskId;
  }

  /**
   * Handle task submission when agent is offline
   */
  private async handleOfflineAgent(
    taskId: string,
    agentId: string,
    wsMsg: any,
    slackContext: SlackContext,
    parentTaskId?: string,
  ): Promise<void> {
    // Queue message for when agent comes online
    this.offlineQueue.enqueue(agentId, wsMsg);
    this.taskRepo.update(taskId, { status: 'queued' });

    // Swap hourglass for queued emoji on the user's message (only for root tasks)
    if (!parentTaskId && slackContext.messageTs) {
      await this.notifier.removeReaction(slackContext.channelId, slackContext.messageTs, 'hourglass_flowing_sand');
      await this.notifier.addReaction(slackContext.channelId, slackContext.messageTs, 'inbox_tray');
    }

    // Notify user (only for root tasks to avoid spam)
    if (!parentTaskId) {
      await this.notifier.postBlocks(
        slackContext.channelId,
        ResponseBuilder.queuedOfflineBlocks(taskId),
        'Agent is offline. Task queued.',
        slackContext.threadTs,
      );
    }

    logger.info({ taskId, agentId, parentTaskId }, 'Task queued for offline agent');
  }
}
