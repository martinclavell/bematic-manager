import { query, type SDKMessage, type SDKResultMessage, type SDKAssistantMessage } from '@anthropic-ai/claude-code';
import {
  isSystemInitMessage,
  isResultMessage,
  isAssistantMessage,
  extractSessionId,
  extractResultText,
  hasTextContent,
  type QueryOptions,
} from '../types/claude-sdk.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  MessageType,
  Limits,
  createWSMessage,
  createLogger,
  performanceMonitor,
  type TaskSubmitPayload,
  type AttachmentResult,
} from '@bematic/common';
import type { WSClient } from '../connection/ws-client.js';
import type { ResourceLimits } from '../monitoring/resource-monitor.js';
import { TempFileManager } from './temp-file-manager.js';

const logger = createLogger('claude-executor');

export interface ExecutionResult {
  result: string;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  filesChanged: string[];
  commandsRun: string[];
  durationMs: number;
  /** Number of auto-continuations that were performed (0 = completed in one shot) */
  continuations: number;
  /** Attachment processing results */
  attachmentResults?: AttachmentResult[];
}

/** Result of a single Claude SDK invocation (one query() call) */
interface InvocationResult {
  resultText: string;
  resultIsError: boolean;
  sessionId: string | null;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
}

export class ClaudeExecutor {
  private tempFileManager: TempFileManager;

  constructor(
    private readonly wsClient: WSClient,
    private readonly defaultMaxContinuations: number = Limits.MAX_CONTINUATIONS,
    private readonly resourceLimits?: ResourceLimits,
    tempFileOptions?: {
      maxAgeHours?: number;
      maxTotalSizeMB?: number;
      cleanupIntervalMs?: number;
    }
  ) {
    this.tempFileManager = new TempFileManager(tempFileOptions);
  }

  /**
   * Get temp file statistics
   */
  getTempFileStats() {
    return this.tempFileManager.getStats();
  }

  /**
   * Get list of tracked temp files
   */
  getTrackedTempFiles() {
    return this.tempFileManager.getTrackedFiles();
  }

  /**
   * Manually clean up all temp files
   */
  async cleanupAllTempFiles() {
    return this.tempFileManager.cleanupAll();
  }

  /**
   * Perform temp file cleanup
   */
  async performTempFileCleanup() {
    return this.tempFileManager.performCleanup();
  }

  /**
   * Stop all background timers and clean up resources
   */
  destroy() {
    this.tempFileManager.stop();
  }

  /**
   * Process file attachments from Slack with retry logic and failure tracking.
   * Returns results for each attachment including success/failure status.
   */
  private async processAttachments(task: TaskSubmitPayload): Promise<{ results: AttachmentResult[]; savedPaths: string[] }> {
    if (!task.attachments || task.attachments.length === 0) {
      return { results: [], savedPaths: [] };
    }

    const attachDir = join(task.localPath, '.bematic-attachments');
    if (!existsSync(attachDir)) {
      await performanceMonitor.recordFileOperation(
        'mkdir',
        () => mkdir(attachDir, { recursive: true }),
        { path: attachDir }
      );
    }

    const results: AttachmentResult[] = [];
    const savedPaths: string[] = [];

    for (const attachment of task.attachments) {
      const result = await this.processAttachmentWithRetry(attachment, attachDir, task.taskId);
      results.push(result);

      if (result.status === 'success' && result.path) {
        savedPaths.push(result.path);
      }
    }

    return { results, savedPaths };
  }

  /**
   * Process a single attachment with exponential backoff retry logic.
   */
  private async processAttachmentWithRetry(
    attachment: { name: string; mimetype: string; data: string; size: number },
    attachDir: string,
    taskId: string,
    maxRetries = 3
  ): Promise<AttachmentResult> {
    const baseDelay = 1000; // 1 second base delay

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Use taskId prefix to avoid collisions
        const safeFilename = `${taskId.slice(-8)}_${attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = join(attachDir, safeFilename);

        // Validate base64 data
        if (!attachment.data || typeof attachment.data !== 'string') {
          throw new Error('Invalid attachment data: missing or non-string base64 data');
        }

        // Validate attachment size vs decoded size
        const buffer = Buffer.from(attachment.data, 'base64');
        if (buffer.length === 0) {
          throw new Error('Invalid attachment data: decoded to empty buffer');
        }

        // Write file atomically by writing to temp file first
        const tempPath = `${filePath}.tmp`;
        await performanceMonitor.recordFileOperation(
          'writeFile',
          () => writeFile(tempPath, buffer),
          { path: tempPath, size: buffer.length }
        );

        // Verify the written file
        if (!existsSync(tempPath)) {
          throw new Error('File was not written to disk');
        }

        // Atomic rename
        const fs = await import('node:fs/promises');
        await performanceMonitor.recordFileOperation(
          'rename',
          () => fs.rename(tempPath, filePath),
          { from: tempPath, to: filePath }
        );

        // Track the file for cleanup
        this.tempFileManager.trackFile(filePath, taskId);

        logger.info(
          {
            name: attachment.name,
            path: filePath,
            size: buffer.length,
            attempts: attempt + 1
          },
          'Successfully saved attachment',
        );

        return {
          name: attachment.name,
          status: 'success',
          path: filePath,
          retries: attempt
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.warn(
          {
            name: attachment.name,
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            error: errorMessage
          },
          'Attachment processing attempt failed',
        );

        // If this was the last attempt, return failure
        if (attempt === maxRetries) {
          logger.error(
            {
              name: attachment.name,
              error: errorMessage,
              totalAttempts: maxRetries + 1
            },
            'Failed to save attachment after all retries',
          );

          return {
            name: attachment.name,
            status: 'failed',
            error: errorMessage,
            retries: maxRetries
          };
        }

        // Wait with exponential backoff before retry
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This should never be reached, but TypeScript requires it
    return {
      name: attachment.name,
      status: 'failed',
      error: 'Unexpected error in retry logic',
      retries: maxRetries
    };
  }

  /**
   * Auto-commit and push changes if enabled for the project
   */
  private async autoCommitPush(task: TaskSubmitPayload, filesChanged: Set<string>): Promise<void> {
    if (!task.autoCommitPush || filesChanged.size === 0) {
      return;
    }

    try {
      logger.info({ taskId: task.taskId, filesChanged: filesChanged.size }, 'Auto-commit enabled, committing changes');

      // Send progress update
      this.wsClient.send(
        createWSMessage(MessageType.TASK_PROGRESS, {
          taskId: task.taskId,
          type: 'info',
          message: ':floppy_disk: Auto-committing changes...',
          timestamp: Date.now(),
        }),
      );

      // Stage all changes
      execSync('git add -A', { cwd: task.localPath, encoding: 'utf-8' });

      // Create commit message
      const fileList = Array.from(filesChanged).join(', ');
      const commitMessage = `Auto-commit: ${task.botName} ${task.command}

Files changed: ${fileList}

🤖 Generated with Bematic Manager
Task: ${task.taskId}`;

      // Commit
      execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
        cwd: task.localPath,
        encoding: 'utf-8'
      });

      // Push
      execSync('git push', { cwd: task.localPath, encoding: 'utf-8' });

      logger.info({ taskId: task.taskId }, 'Successfully committed and pushed changes');

      // Send success notification
      this.wsClient.send(
        createWSMessage(MessageType.TASK_PROGRESS, {
          taskId: task.taskId,
          type: 'info',
          message: ':white_check_mark: Changes committed and pushed',
          timestamp: Date.now(),
        }),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ taskId: task.taskId, error: errorMessage }, 'Auto-commit failed');

      // Send warning but don't fail the task
      this.wsClient.send(
        createWSMessage(MessageType.TASK_PROGRESS, {
          taskId: task.taskId,
          type: 'info',
          message: `:warning: Auto-commit failed: ${errorMessage}`,
          timestamp: Date.now(),
        }),
      );
    }
  }

  /**
   * Notify about attachment failures via WebSocket messages
   */
  private async notifyAttachmentFailures(task: TaskSubmitPayload, failedAttachments: AttachmentResult[]): Promise<void> {
    // Send warning emoji reaction notification
    this.wsClient.send(
      createWSMessage(MessageType.TASK_PROGRESS, {
        taskId: task.taskId,
        type: 'info',
        message: `:warning: ${failedAttachments.length} attachment(s) failed to process`,
        timestamp: Date.now(),
      }),
    );

    // Send detailed failure information
    const failureDetails = failedAttachments.map(f =>
      `• **${f.name}** - ${f.error} (${f.retries || 0} retries)`
    ).join('\n');

    this.wsClient.send(
      createWSMessage(MessageType.TASK_PROGRESS, {
        taskId: task.taskId,
        type: 'info',
        message: `**Attachment Processing Failures:**\n${failureDetails}\n\n*The task will continue without these files. You can re-upload them in a follow-up message.*`,
        timestamp: Date.now(),
      }),
    );

    logger.warn(
      {
        taskId: task.taskId,
        failedCount: failedAttachments.length,
        failedFiles: failedAttachments.map(f => ({ name: f.name, error: f.error, retries: f.retries }))
      },
      'Notified user about attachment failures'
    );
  }

  async execute(
    task: TaskSubmitPayload,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const filesChanged = new Set<string>();
    const commandsRun = new Set<string>();
    let assistantTurnCount = 0;

    // Process file attachments with retry logic and failure tracking
    const { results: attachmentResults, savedPaths: savedFiles } = await this.processAttachments(task);
    const failedAttachments = attachmentResults.filter(r => r.status === 'failed');

    // Notify about attachment failures
    if (failedAttachments.length > 0) {
      await this.notifyAttachmentFailures(task, failedAttachments);
    }

    // Augment prompt with successfully saved files
    if (savedFiles.length > 0) {
      const fileList = savedFiles.map((p) => `- ${p}`).join('\n');
      task = {
        ...task,
        prompt: `${task.prompt}\n\nThe user attached files that have been saved to disk. Read them using the Read tool:\n${fileList}`,
      };
      logger.info({ taskId: task.taskId, fileCount: savedFiles.length, failedCount: failedAttachments.length }, 'Augmented prompt with saved file paths');
    }

    // Aggregate metrics across all continuations
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    let sessionId: string | null = null;
    let lastResultText = '';
    let continuationCount = 0;

    const maxContinuations = task.maxContinuations ?? this.defaultMaxContinuations;

    logger.info(
      { taskId: task.taskId, command: task.command, model: task.model, maxContinuations },
      'Starting Claude execution',
    );

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      // Send ACK
      this.wsClient.send(
        createWSMessage(MessageType.TASK_ACK, {
          taskId: task.taskId,
          accepted: true,
        }),
      );

      const abortController = new AbortController();

      // Forward external abort signal
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
      }

      // Add configurable timeout for task execution
      const taskTimeoutMs = this.resourceLimits?.taskTimeoutMs ?? Limits.CLAUDE_API_TIMEOUT_MS;
      timeoutId = setTimeout(() => {
        logger.warn(
          {
            taskId: task.taskId,
            timeoutMs: taskTimeoutMs,
            source: this.resourceLimits ? 'resource-limits' : 'default-limits'
          },
          'Task execution timeout - aborting'
        );
        abortController.abort();
      }, taskTimeoutMs);

      logger.info(
        { taskId: task.taskId, hasApiKey: !!process.env['ANTHROPIC_API_KEY'], cwd: task.localPath },
        'Pre-launch check',
      );

      // --- First invocation ---
      const initialResumeId = task.resumeSessionId ?? null;
      let invocation = await this.runInvocation({
        task,
        resumeSessionId: initialResumeId,
        abortController,
        filesChanged,
        commandsRun,
        assistantTurnCount,
      });

      assistantTurnCount = invocation.assistantTurnCount;
      totalInputTokens += invocation.result.inputTokens;
      totalOutputTokens += invocation.result.outputTokens;
      totalCost += invocation.result.totalCost;
      sessionId = invocation.result.sessionId ?? sessionId;
      lastResultText = invocation.result.resultText;

      // --- Auto-continue loop ---
      while (
        invocation.result.resultIsError &&
        invocation.result.resultText === 'error_max_turns' &&
        continuationCount < maxContinuations &&
        sessionId &&
        !abortSignal?.aborted
      ) {
        continuationCount++;

        logger.info(
          {
            taskId: task.taskId,
            continuation: continuationCount,
            maxContinuations,
            sessionId,
          },
          'Auto-continuing after max_turns',
        );

        // Notify user about continuation
        this.wsClient.send(
          createWSMessage(MessageType.TASK_PROGRESS, {
            taskId: task.taskId,
            type: 'info',
            message: `:repeat: Auto-continuing task (${continuationCount}/${maxContinuations})...`,
            timestamp: Date.now(),
          }),
        );

        // Small delay to let the previous session finalize
        await new Promise((resolve) => setTimeout(resolve, 1_000));

        invocation = await this.runInvocation({
          task,
          resumeSessionId: sessionId,
          abortController,
          filesChanged,
          commandsRun,
          assistantTurnCount,
          continuationPrompt: 'Continue where you left off. Complete the remaining work from the original task.',
        });

        assistantTurnCount = invocation.assistantTurnCount;
        totalInputTokens += invocation.result.inputTokens;
        totalOutputTokens += invocation.result.outputTokens;
        totalCost += invocation.result.totalCost;
        sessionId = invocation.result.sessionId ?? sessionId;
        lastResultText = invocation.result.resultText;
      }

      const durationMs = Date.now() - startTime;

      // If we exhausted all continuations and STILL hit max_turns
      if (
        invocation.result.resultIsError &&
        invocation.result.resultText === 'error_max_turns'
      ) {
        const totalTurns = Limits.MAX_TURNS_PER_INVOCATION * (continuationCount + 1);
        const partialResult = `_Reached the maximum turn limit (${totalTurns} turns across ${continuationCount + 1} invocations). Here's what was accomplished so far._\n\nThe task was too complex to complete even with auto-continuation. You can continue by replying in this thread.`;

        // Auto-commit and push if enabled
        await this.autoCommitPush(task, filesChanged);

        const result: ExecutionResult = {
          result: partialResult,
          sessionId,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCost: totalCost,
          filesChanged: Array.from(filesChanged),
          commandsRun: Array.from(commandsRun),
          durationMs,
          continuations: continuationCount,
          attachmentResults: attachmentResults.length > 0 ? attachmentResults : undefined,
        };

        this.wsClient.send(
          createWSMessage(MessageType.TASK_COMPLETE, {
            taskId: task.taskId,
            ...result,
          }),
        );

        logger.warn(
          {
            taskId: task.taskId,
            durationMs,
            cost: totalCost,
            totalTurns,
            continuations: continuationCount,
          },
          'Claude execution exhausted all continuations',
        );

        // Clean up temp files for this task
        this.tempFileManager.cleanupTaskFiles(task.taskId).catch((error) => {
          logger.error({ error, taskId: task.taskId }, 'Failed to cleanup task files');
        });

        // Clear the task timeout to prevent orphaned timer
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        return result;
      }

      // Record task execution performance
      performanceMonitor.recordEvent({
        type: 'task_execution',
        operation: `${task.botName}.${task.command}`,
        duration: durationMs,
        success: true,
        metadata: {
          taskId: task.taskId,
          model: task.model,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCost: totalCost,
          continuations: continuationCount,
          filesChanged: filesChanged.size,
          commandsRun: commandsRun.size,
        },
      });

      // Auto-commit and push if enabled
      await this.autoCommitPush(task, filesChanged);

      // Normal completion (either first-shot or after successful continuation)
      const result: ExecutionResult = {
        result: lastResultText || '(no output)',
        sessionId,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        estimatedCost: totalCost,
        filesChanged: Array.from(filesChanged),
        commandsRun: Array.from(commandsRun),
        durationMs,
        continuations: continuationCount,
        attachmentResults: attachmentResults.length > 0 ? attachmentResults : undefined,
      };

      // Send completion
      this.wsClient.send(
        createWSMessage(MessageType.TASK_COMPLETE, {
          taskId: task.taskId,
          ...result,
        }),
      );

      logger.info(
        {
          taskId: task.taskId,
          durationMs,
          cost: totalCost,
          continuations: continuationCount,
        },
        'Claude execution completed',
      );

      // Clean up temp files for this task
      this.tempFileManager.cleanupTaskFiles(task.taskId).catch((error) => {
        logger.error({ error, taskId: task.taskId }, 'Failed to cleanup task files');
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return result;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Clean up temp files for this task even on error
      this.tempFileManager.cleanupTaskFiles(task.taskId).catch((cleanupError) => {
        logger.error({ error: cleanupError, taskId: task.taskId }, 'Failed to cleanup task files on error');
      });

      const durationMs = Date.now() - startTime;
      const rawError = error instanceof Error ? error.message : String(error);
      const errorMessage = rawError;

      // Record failed task execution
      performanceMonitor.recordEvent({
        type: 'task_execution',
        operation: `${task.botName}.${task.command}`,
        duration: durationMs,
        success: false,
        metadata: {
          taskId: task.taskId,
          error: errorMessage,
          model: task.model,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          estimatedCost: totalCost,
          continuations: continuationCount,
        },
      });

      logger.error({ taskId: task.taskId, error: errorMessage, durationMs }, 'Claude execution failed');

      this.wsClient.send(
        createWSMessage(MessageType.TASK_ERROR, {
          taskId: task.taskId,
          error: errorMessage,
          recoverable: !abortSignal?.aborted,
          sessionId: sessionId ?? null,
        }),
      );

      throw new Error(errorMessage);
    }
  }

  /**
   * Run a single Claude SDK query() invocation and process all streamed messages.
   * Returns the invocation result without sending TASK_COMPLETE/TASK_ERROR
   * (the caller handles that).
   */
  private async runInvocation(params: {
    task: TaskSubmitPayload;
    resumeSessionId: string | null;
    abortController: AbortController;
    filesChanged: Set<string>;
    commandsRun: Set<string>;
    assistantTurnCount: number;
    continuationPrompt?: string;
  }): Promise<{ result: InvocationResult; assistantTurnCount: number }> {
    const { task, resumeSessionId, abortController, filesChanged, commandsRun } = params;
    let { assistantTurnCount } = params;

    let resultText = '';
    let resultIsError = false;
    let sessionId: string | null = null;
    let totalCost = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    const prompt = params.continuationPrompt ?? task.prompt;

    const queryOptions: QueryOptions = {
      customSystemPrompt: task.systemPrompt || undefined,
      model: task.model,
      maxTurns: Limits.MAX_TURNS_PER_INVOCATION,
      cwd: task.localPath,
      allowedTools: task.allowedTools.length > 0 ? task.allowedTools : undefined,
      abortController,
      permissionMode: 'bypassPermissions',
      env: {
        ...process.env as Record<string, string>,
        ...(process.env['ANTHROPIC_API_KEY'] ? { ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] } : {}),
      },
      stderr: (data: string) => {
        logger.error({ taskId: task.taskId, stderr: data }, 'Claude stderr');
      },
    };

    // Resume previous session
    if (resumeSessionId) {
      queryOptions['resume'] = resumeSessionId;
      logger.info({ taskId: task.taskId, resumeSessionId }, 'Resuming Claude session');
    }

    const stream = query({
      prompt,
      options: queryOptions,
    });

    for await (const message of stream) {
      // Add newline separator between different assistant messages
      if (isAssistantMessage(message)) {
        const hasText = hasTextContent(message);
        if (hasText && assistantTurnCount > 0) {
          this.wsClient.send(
            createWSMessage(MessageType.TASK_STREAM, {
              taskId: task.taskId,
              delta: '\n\n',
              timestamp: Date.now(),
            }),
          );
        }
        if (hasText) assistantTurnCount++;
      }

      this.handleMessage(task.taskId, message, filesChanged, commandsRun);

      // Capture session ID from init or result messages
      if (isSystemInitMessage(message)) {
        sessionId = extractSessionId(message);
        logger.info({ taskId: task.taskId, sessionId }, 'Claude session started');
      }

      // Extract result from result message
      if (isResultMessage(message)) {
        const extractedSessionId = extractSessionId(message);
        if (extractedSessionId) {
          sessionId = extractedSessionId;
        }
        totalCost = message.total_cost_usd;
        inputTokens = message.usage.input_tokens;
        outputTokens = message.usage.output_tokens;
        resultIsError = message.is_error;
        resultText = extractResultText(message);
      }
    }

    return {
      result: {
        resultText,
        resultIsError,
        sessionId,
        totalCost,
        inputTokens,
        outputTokens,
      },
      assistantTurnCount,
    };
  }

  private handleMessage(
    taskId: string,
    message: SDKMessage,
    filesChanged: Set<string>,
    commandsRun: Set<string>,
  ): void {
    if (message.type === 'assistant') {
      const assistantMsg = message as SDKAssistantMessage;

      // Process content blocks for tool use info
      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === 'tool_use') {
            const toolName = block.name;
            const toolInput = block.input as Record<string, unknown>;

            // Track file changes
            if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) {
              const filePath = (toolInput['file_path'] ?? toolInput['notebook_path']) as string;
              if (filePath) filesChanged.add(filePath);
            }

            // Track commands
            if (toolName === 'Bash') {
              const cmd = toolInput['command'] as string;
              if (cmd) commandsRun.add(cmd.slice(0, 200));
            }

            // Build descriptive progress message
            const progressMessage = this.describeToolUse(toolName, toolInput);

            // Send progress
            this.wsClient.send(
              createWSMessage(MessageType.TASK_PROGRESS, {
                taskId,
                type: 'tool_use',
                message: progressMessage,
                timestamp: Date.now(),
              }),
            );
          }

          if (block.type === 'text') {
            // Send text as stream
            this.wsClient.send(
              createWSMessage(MessageType.TASK_STREAM, {
                taskId,
                delta: block.text,
                timestamp: Date.now(),
              }),
            );
          }
        }
      }
    }
  }

  /** Build a human-readable description of a tool use */
  private describeToolUse(toolName: string, input: Record<string, unknown>): string {
    const shortPath = (p: string) => {
      const parts = p.replace(/\\/g, '/').split('/');
      return parts.length > 2 ? parts.slice(-2).join('/') : p;
    };

    switch (toolName) {
      case 'Read': {
        const fp = input['file_path'] as string;
        return fp ? `Reading \`${shortPath(fp)}\`` : 'Reading file';
      }
      case 'Write': {
        const fp = input['file_path'] as string;
        return fp ? `Writing \`${shortPath(fp)}\`` : 'Writing file';
      }
      case 'Edit': {
        const fp = input['file_path'] as string;
        return fp ? `Editing \`${shortPath(fp)}\`` : 'Editing file';
      }
      case 'Glob': {
        const pattern = input['pattern'] as string;
        return pattern ? `Searching files: \`${pattern}\`` : 'Searching files';
      }
      case 'Grep': {
        const pattern = input['pattern'] as string;
        return pattern ? `Searching for: \`${pattern}\`` : 'Searching code';
      }
      case 'Bash': {
        const cmd = (input['command'] as string)?.slice(0, 80);
        return cmd ? `Running: \`${cmd}\`` : 'Running command';
      }
      case 'NotebookEdit': {
        const fp = input['notebook_path'] as string;
        return fp ? `Editing notebook \`${shortPath(fp)}\`` : 'Editing notebook';
      }
      case 'Task': {
        const desc = input['description'] as string;
        return desc ? `Spawning task: ${desc}` : 'Spawning sub-task';
      }
      case 'WebSearch': {
        const q = input['query'] as string;
        return q ? `Searching web: \`${q}\`` : 'Searching web';
      }
      case 'WebFetch': {
        return 'Fetching web content';
      }
      default:
        return `Using ${toolName}`;
    }
  }
}
