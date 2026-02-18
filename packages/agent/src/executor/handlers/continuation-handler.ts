import { MessageType, Limits, createWSMessage, createLogger, type TaskSubmitPayload } from '@bematic/common';
import { query, type SDKMessage, type SDKResultMessage, type SDKAssistantMessage } from '@anthropic-ai/claude-code';
import type { WSClient } from '../../connection/ws-client.js';
import { MessageHandler } from './message-handler.js';

const logger = createLogger('continuation-handler');

/** Result of a single Claude SDK invocation (one query() call) */
export interface InvocationResult {
  resultText: string;
  resultIsError: boolean;
  sessionId: string | null;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Handles Claude invocation and auto-continuation logic
 * Responsibilities:
 * - Run single Claude SDK query()
 * - Process stream messages
 * - Handle max_turns continuation loop
 */
export class ContinuationHandler {
  private readonly messageHandler: MessageHandler;

  constructor(private readonly wsClient: WSClient) {
    this.messageHandler = new MessageHandler(wsClient);
  }

  /**
   * Run a single Claude SDK query() invocation and process all streamed messages.
   * Returns the invocation result without sending TASK_COMPLETE/TASK_ERROR
   */
  async runInvocation(params: {
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

      this.messageHandler.handle(task.taskId, message, filesChanged, commandsRun);

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

  /**
   * Send continuation notification to user
   */
  sendContinuationNotification(
    taskId: string,
    currentContinuation: number,
    maxContinuations: number,
  ): void {
    this.wsClient.send(
      createWSMessage(MessageType.TASK_PROGRESS, {
        taskId,
        type: 'info',
        message: `:repeat: Auto-continuing task (${currentContinuation}/${maxContinuations})...`,
        timestamp: Date.now(),
      }),
    );
  }
}
