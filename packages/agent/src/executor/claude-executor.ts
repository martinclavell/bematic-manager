import { query, type SDKMessage, type SDKResultMessage, type SDKAssistantMessage } from '@anthropic-ai/claude-code';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MessageType,
  Limits,
  createWSMessage,
  createLogger,
  type TaskSubmitPayload,
} from '@bematic/common';
import type { WSClient } from '../connection/ws-client.js';

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
  constructor(
    private readonly wsClient: WSClient,
    private readonly defaultMaxContinuations: number = Limits.MAX_CONTINUATIONS,
  ) {}

  /**
   * Save file attachments from Slack to a temp directory inside the project.
   * Returns the list of saved file paths for inclusion in the prompt.
   */
  private saveAttachments(task: TaskSubmitPayload): string[] {
    if (!task.attachments || task.attachments.length === 0) return [];

    const attachDir = join(task.localPath, '.bematic-attachments');
    if (!existsSync(attachDir)) {
      mkdirSync(attachDir, { recursive: true });
    }

    const savedPaths: string[] = [];

    for (const attachment of task.attachments) {
      try {
        // Use taskId prefix to avoid collisions
        const safeFilename = `${task.taskId.slice(-8)}_${attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = join(attachDir, safeFilename);
        const buffer = Buffer.from(attachment.data, 'base64');

        writeFileSync(filePath, buffer);
        savedPaths.push(filePath);

        logger.info(
          { name: attachment.name, path: filePath, size: buffer.length },
          'Saved attachment to disk',
        );
      } catch (error) {
        logger.error(
          { name: attachment.name, error: error instanceof Error ? error.message : String(error) },
          'Failed to save attachment',
        );
      }
    }

    return savedPaths;
  }

  async execute(
    task: TaskSubmitPayload,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const filesChanged = new Set<string>();
    const commandsRun = new Set<string>();
    let assistantTurnCount = 0;

    // Save file attachments to disk and augment the prompt
    const savedFiles = this.saveAttachments(task);
    if (savedFiles.length > 0) {
      const fileList = savedFiles.map((p) => `- ${p}`).join('\n');
      task = {
        ...task,
        prompt: `${task.prompt}\n\nThe user attached files that have been saved to disk. Read them using the Read tool:\n${fileList}`,
      };
      logger.info({ taskId: task.taskId, fileCount: savedFiles.length }, 'Augmented prompt with saved file paths');
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

      // Add global timeout for Claude API calls
      timeoutId = setTimeout(() => {
        logger.warn({ taskId: task.taskId, timeoutMs: Limits.CLAUDE_API_TIMEOUT_MS }, 'Claude API timeout - aborting');
        abortController.abort();
      }, Limits.CLAUDE_API_TIMEOUT_MS);

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

        return result;
      }

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

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return result;
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const durationMs = Date.now() - startTime;
      const rawError = error instanceof Error ? error.message : String(error);
      const errorMessage = rawError;

      logger.error({ taskId: task.taskId, error: errorMessage, durationMs }, 'Claude execution failed');

      this.wsClient.send(
        createWSMessage(MessageType.TASK_ERROR, {
          taskId: task.taskId,
          error: errorMessage,
          recoverable: !abortSignal?.aborted,
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

    const queryOptions: Record<string, unknown> = {
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
      options: queryOptions as any,
    });

    for await (const message of stream) {
      // Add newline separator between different assistant messages
      if (message.type === 'assistant') {
        const hasText = (message as SDKAssistantMessage).message?.content?.some(
          (b: any) => b.type === 'text' && b.text,
        );
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
      if (message.type === 'system' && (message as any).subtype === 'init') {
        sessionId = (message as any).session_id ?? null;
        logger.info({ taskId: task.taskId, sessionId }, 'Claude session started');
      }

      // Extract result from result message
      if (message.type === 'result') {
        if ((message as any).session_id) {
          sessionId = (message as any).session_id;
        }
        const resultMsg = message as SDKResultMessage;
        totalCost = resultMsg.total_cost_usd;
        inputTokens = resultMsg.usage.input_tokens;
        outputTokens = resultMsg.usage.output_tokens;
        resultIsError = resultMsg.is_error;
        if (resultMsg.subtype === 'success') {
          resultText = resultMsg.result;
        } else {
          resultText = (resultMsg as any).result ?? resultMsg.subtype;
        }
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
