import { query, type SDKMessage, type SDKResultMessage, type SDKAssistantMessage } from '@anthropic-ai/claude-code';
import {
  MessageType,
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
}

export class ClaudeExecutor {
  constructor(private readonly wsClient: WSClient) {}

  async execute(
    task: TaskSubmitPayload,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const filesChanged = new Set<string>();
    const commandsRun = new Set<string>();
    let resultText = '';
    let resultIsError = false;
    let sessionId: string | null = null;
    let totalCost = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    logger.info(
      { taskId: task.taskId, command: task.command, model: task.model },
      'Starting Claude execution',
    );

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

      logger.info(
        { taskId: task.taskId, hasApiKey: !!process.env['ANTHROPIC_API_KEY'], cwd: task.localPath },
        'Pre-launch check',
      );

      const queryOptions: Record<string, unknown> = {
        customSystemPrompt: task.systemPrompt || undefined,
        model: task.model,
        maxTurns: 50,
        cwd: task.localPath,
        allowedTools: task.allowedTools.length > 0 ? task.allowedTools : undefined,
        abortController,
        permissionMode: 'bypassPermissions',
        env: {
          ...process.env as Record<string, string>,
          // Only pass API key if explicitly set; otherwise SDK uses Claude subscription auth
          ...(process.env['ANTHROPIC_API_KEY'] ? { ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] } : {}),
        },
        stderr: (data: string) => {
          logger.error({ taskId: task.taskId, stderr: data }, 'Claude stderr');
        },
      };

      // Resume previous session if provided (thread continuation)
      if (task.resumeSessionId) {
        queryOptions['resume'] = task.resumeSessionId;
        logger.info({ taskId: task.taskId, resumeSessionId: task.resumeSessionId }, 'Resuming Claude session');
      }

      const stream = query({
        prompt: task.prompt,
        options: queryOptions as any,
      });

      for await (const message of stream) {
        this.handleMessage(task.taskId, message, filesChanged, commandsRun);

        // Capture session ID from init or result messages
        if (message.type === 'system' && (message as any).subtype === 'init') {
          sessionId = (message as any).session_id ?? null;
          logger.info({ taskId: task.taskId, sessionId }, 'Claude session started');
        }

        // Extract result from result message
        if (message.type === 'result') {
          // Also grab session_id from result if available
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
            // For error subtypes, extract the result from the raw message
            resultText = (resultMsg as any).result ?? resultMsg.subtype;
          }
        }
      }

      const durationMs = Date.now() - startTime;

      const result: ExecutionResult = {
        result: resultText || '(no output)',
        sessionId,
        inputTokens,
        outputTokens,
        estimatedCost: totalCost,
        filesChanged: Array.from(filesChanged),
        commandsRun: Array.from(commandsRun),
        durationMs,
      };

      // Send completion
      this.wsClient.send(
        createWSMessage(MessageType.TASK_COMPLETE, {
          taskId: task.taskId,
          ...result,
        }),
      );

      logger.info(
        { taskId: task.taskId, durationMs, cost: totalCost },
        'Claude execution completed',
      );

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const rawError = error instanceof Error ? error.message : String(error);
      // Use the actual result text from the SDK if available (e.g. "Credit balance is too low")
      const errorMessage = (resultIsError && resultText) ? resultText : rawError;

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
