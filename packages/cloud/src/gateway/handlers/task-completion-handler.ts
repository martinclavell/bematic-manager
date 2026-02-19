import { createLogger, taskCompleteSchema } from '@bematic/common';
import { BotRegistry, ResponseBuilder } from '@bematic/bots';
import type { TaskRepository, AuditLogRepository, ProjectRepository, TaskRow } from '@bematic/db';
import type { NotificationService } from '../../services/notification.service.js';
import type { CommandService } from '../../services/command.service.js';
import { markdownToSlack } from '../../utils/markdown-to-slack.js';

const logger = createLogger('task-completion-handler');

export class TaskCompletionHandler {
  private commandService: CommandService | null = null;
  private projectRepo: ProjectRepository | null = null;

  constructor(
    private readonly taskRepo: TaskRepository,
    private readonly auditLogRepo: AuditLogRepository,
    private readonly notifier: NotificationService,
  ) {}

  /**
   * Inject CommandService after construction (avoids circular dependency)
   */
  setCommandService(commandService: CommandService, projectRepo: ProjectRepository): void {
    this.commandService = commandService;
    this.projectRepo = projectRepo;
  }

  async handle(agentId: string, payload: unknown): Promise<void> {
    const parsed = taskCompleteSchema.parse(payload);
    const task = this.taskRepo.findById(parsed.taskId);
    if (!task) {
      logger.warn({ taskId: parsed.taskId }, 'Received completion for unknown task');
      return;
    }

    // Update database
    this.updateTaskInDatabase(parsed);

    // Handle decomposition workflow if needed
    if (task.command === 'decompose' && this.commandService && this.projectRepo) {
      await this.handleDecompositionTaskComplete(task, parsed.result);
      return;
    }

    // Handle subtask completion
    if (task.parentTaskId && this.taskRepo.areAllSubtasksComplete(task.parentTaskId)) {
      await this.handleAllSubtasksComplete(task.parentTaskId, agentId);
      // Continue to post individual subtask result
    }

    // Post completion message to Slack
    await this.postCompletionMessage(task, parsed, agentId);

    logger.info(
      {
        taskId: parsed.taskId,
        cost: parsed.estimatedCost,
        durationMs: parsed.durationMs,
        parentTaskId: task.parentTaskId,
      },
      'Task completed',
    );
  }

  private updateTaskInDatabase(parsed: ReturnType<typeof taskCompleteSchema.parse>): void {
    this.taskRepo.complete(parsed.taskId, parsed.result, {
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      estimatedCost: parsed.estimatedCost,
      filesChanged: parsed.filesChanged,
      commandsRun: parsed.commandsRun,
    });

    if (parsed.sessionId) {
      this.taskRepo.update(parsed.taskId, { sessionId: parsed.sessionId });
    }
  }

  private async postCompletionMessage(
    task: TaskRow,
    parsed: ReturnType<typeof taskCompleteSchema.parse>,
    agentId: string,
  ): Promise<void> {
    // Convert markdown to Slack format
    const slackResult = markdownToSlack(parsed.result);

    // Get project to access localPath for basePath stripping
    const project = this.projectRepo?.findById(task.projectId);
    const basePath = project?.localPath;

    // Format result using bot-specific formatter
    const bot = BotRegistry.get(task.botName);
    const blocks = bot
      ? bot.formatResult({ ...parsed, result: slackResult, basePath })
      : ResponseBuilder.taskCompleteBlocks(slackResult, { ...parsed, basePath });

    // Add success reaction to original message (root tasks only)
    if (!task.parentTaskId && task.slackMessageTs) {
      await this.swapReaction(task, 'white_check_mark');

      // If this is a thread reply, also update the main thread message
      if (task.slackThreadTs && task.slackMessageTs !== task.slackThreadTs) {
        await this.notifier.removeReaction(
          task.slackChannelId,
          task.slackThreadTs,
          'hourglass_flowing_sand',
        );
        await this.notifier.addReaction(task.slackChannelId, task.slackThreadTs, 'hourglass_flowing_sand');
      }
    }

    // Post completion blocks to Slack
    await this.notifier.postBlocks(
      task.slackChannelId,
      blocks,
      `Task completed: ${parsed.result.slice(0, 100)}`,
      task.slackThreadTs,
    );

    // Check for file upload marker in result (for NetSuite audits, etc.)
    await this.handleFileUploadIfPresent(task, parsed.result);

    // Log to audit trail
    this.auditLogRepo.log('task:completed', 'task', parsed.taskId, null, {
      agentId,
      cost: parsed.estimatedCost,
      durationMs: parsed.durationMs,
      parentTaskId: task.parentTaskId,
    });
  }

  private async handleFileUploadIfPresent(task: TaskRow, result: string): Promise<void> {
    // Look for REPORT_FILE_PATH: marker in the result
    const filePathMatch = result.match(/REPORT_FILE_PATH:\s*(.+?)(?:\n|$)/);
    if (!filePathMatch) return;

    const filePath = filePathMatch[1]!.trim();

    try {
      // Extract filename from path
      const filename = filePath.split('/').pop() || 'audit_report.html';

      // Upload file to Slack
      await this.notifier.uploadFile(
        task.slackChannelId,
        filePath,
        filename,
        'SEO Audit Report',
        '📊 Your SEO audit report is ready! Click to download and view the comprehensive analysis.',
        task.slackThreadTs,
      );

      logger.info(
        { taskId: task.id, filePath, filename },
        'Successfully uploaded audit report to Slack',
      );
    } catch (error) {
      logger.error(
        { error, taskId: task.id, filePath },
        'Failed to upload audit report to Slack',
      );

      // Post error message to user
      await this.notifier.postMessage(
        task.slackChannelId,
        `⚠️ Report generated at \`${filePath}\` but failed to upload to Slack. Please check the file manually.`,
        task.slackThreadTs,
      );
    }
  }

  private async handleDecompositionTaskComplete(task: TaskRow, planningResult: string): Promise<void> {
    if (!this.commandService || !this.projectRepo) {
      logger.error(
        { taskId: task.id },
        'Cannot handle decomposition: CommandService not injected',
      );
      return;
    }

    try {
      await this.commandService.handleDecompositionComplete(task, planningResult, this.projectRepo);
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Error handling decomposition completion');
    }
  }

  private async handleAllSubtasksComplete(parentTaskId: string, agentId: string): Promise<void> {
    const parentTask = this.taskRepo.findById(parentTaskId);
    if (!parentTask) return;

    const subtasks = this.taskRepo.findByParentTaskId(parentTaskId);
    const allCompleted = subtasks.every((t) => t.status === 'completed');
    const anyFailed = subtasks.some((t) => t.status === 'failed');

    // Calculate aggregated metrics
    const totalCost = subtasks.reduce((sum, t) => sum + (t.estimatedCost || 0), 0);
    const totalTokens = subtasks.reduce((sum, t) => sum + (t.inputTokens || 0) + (t.outputTokens || 0), 0);

    // Build summary message
    let summary = `:tada: *All subtasks complete for: ${parentTask.prompt}*\n\n`;
    summary += `*Results:*\n`;

    for (const subtask of subtasks) {
      const emoji = subtask.status === 'completed' ? ':white_check_mark:' : ':x:';
      summary += `${emoji} ${subtask.command}: ${subtask.prompt.slice(0, 50)}...\n`;
    }

    summary += `\n*Total cost:* $${totalCost.toFixed(2)}`;
    summary += `\n*Total tokens:* ${totalTokens.toLocaleString()}`;

    await this.notifier.postMessage(
      parentTask.slackChannelId,
      summary,
      parentTask.slackThreadTs,
    );

    // Mark parent task as complete
    if (allCompleted) {
      this.taskRepo.complete(parentTaskId, 'All subtasks completed successfully', {
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: totalCost,
        filesChanged: [],
        commandsRun: [],
      });
    } else if (anyFailed) {
      this.taskRepo.fail(parentTaskId, 'Some subtasks failed');
    }

    this.auditLogRepo.log('task:subtasks_complete', 'task', parentTaskId, null, {
      agentId,
      subtaskCount: subtasks.length,
      totalCost,
      allCompleted,
    });
  }

  private async swapReaction(task: TaskRow, emoji: string): Promise<void> {
    if (!task.slackMessageTs) return;
    await this.notifier.removeReaction(
      task.slackChannelId,
      task.slackMessageTs,
      'hourglass_flowing_sand',
    );
    await this.notifier.addReaction(task.slackChannelId, task.slackMessageTs, emoji);
  }
}
