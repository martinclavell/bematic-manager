import { MessageType, Limits, createWSMessage, createLogger, type TaskSubmitPayload } from '@bematic/common';
import type { WSClient } from '../connection/ws-client.js';
import { ExecutionTracker, ContinuationHandler } from './handlers/index.js';

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

/**
 * Orchestrates Claude task execution with auto-continuation
 *
 * Refactored from 469 lines into focused modules:
 * - ExecutionTracker: Metrics tracking
 * - ContinuationHandler: Invocation & auto-continue loop
 * - MessageHandler: Stream message processing
 */
export class ClaudeExecutor {
  private readonly continuationHandler: ContinuationHandler;

  constructor(
    private readonly wsClient: WSClient,
    private readonly defaultMaxContinuations: number = Limits.MAX_CONTINUATIONS,
  ) {
    this.continuationHandler = new ContinuationHandler(wsClient);
  }

  async execute(
    task: TaskSubmitPayload,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionResult> {
    const tracker = new ExecutionTracker();
    let assistantTurnCount = 0;
    let sessionId: string | null = null;
    let lastResultText = '';

    const maxContinuations = task.maxContinuations ?? this.defaultMaxContinuations;

    logger.info(
      { taskId: task.taskId, command: task.command, model: task.model, maxContinuations },
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

      // --- First invocation ---
      const initialResumeId = task.resumeSessionId ?? null;
      let invocation = await this.continuationHandler.runInvocation({
        task,
        resumeSessionId: initialResumeId,
        abortController,
        filesChanged: tracker.files,
        commandsRun: tracker.commands,
        assistantTurnCount,
      });

      assistantTurnCount = invocation.assistantTurnCount;
      tracker.addUsage(
        invocation.result.inputTokens,
        invocation.result.outputTokens,
        invocation.result.totalCost,
      );
      sessionId = invocation.result.sessionId ?? sessionId;
      lastResultText = invocation.result.resultText;

      // --- Auto-continue loop ---
      while (
        this.shouldContinue(invocation.result, maxContinuations, tracker.getMetrics().continuations, sessionId, abortSignal)
      ) {
        tracker.incrementContinuations();
        const continuationCount = tracker.getMetrics().continuations;

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
        this.continuationHandler.sendContinuationNotification(task.taskId, continuationCount, maxContinuations);

        // Small delay to let the previous session finalize
        await new Promise((resolve) => setTimeout(resolve, 1_000));

        invocation = await this.continuationHandler.runInvocation({
          task,
          resumeSessionId: sessionId,
          abortController,
          filesChanged: tracker.files,
          commandsRun: tracker.commands,
          assistantTurnCount,
          continuationPrompt: 'Continue where you left off. Complete the remaining work from the original task.',
        });

        assistantTurnCount = invocation.assistantTurnCount;
        tracker.addUsage(
          invocation.result.inputTokens,
          invocation.result.outputTokens,
          invocation.result.totalCost,
        );
        sessionId = invocation.result.sessionId ?? sessionId;
        lastResultText = invocation.result.resultText;
      }

      // Check if we exhausted all continuations
      if (this.isExhausted(invocation.result)) {
        return this.handleExhaustedContinuations(task, tracker, sessionId);
      }

      // Normal completion
      return this.handleCompletion(task, tracker, sessionId, lastResultText);

    } catch (error) {
      return this.handleError(task, tracker, error, abortSignal);
    }
  }

  /**
   * Check if we should continue to next invocation
   */
  private shouldContinue(
    result: any,
    maxContinuations: number,
    currentContinuations: number,
    sessionId: string | null,
    abortSignal?: AbortSignal,
  ): boolean {
    return (
      result.resultIsError &&
      result.resultText === 'error_max_turns' &&
      currentContinuations < maxContinuations &&
      !!sessionId &&
      !abortSignal?.aborted
    );
  }

  /**
   * Check if we exhausted all continuations
   */
  private isExhausted(result: any): boolean {
    return result.resultIsError && result.resultText === 'error_max_turns';
  }

  /**
   * Handle case where all continuations are exhausted
   */
  private handleExhaustedContinuations(
    task: TaskSubmitPayload,
    tracker: ExecutionTracker,
    sessionId: string | null,
  ): ExecutionResult {
    const metrics = tracker.getMetrics();
    const totalTurns = Limits.MAX_TURNS_PER_INVOCATION * (metrics.continuations + 1);
    const partialResult = `_Reached the maximum turn limit (${totalTurns} turns across ${metrics.continuations + 1} invocations). Here's what was accomplished so far._\n\nThe task was too complex to complete even with auto-continuation. You can continue by replying in this thread.`;

    const result: ExecutionResult = {
      result: partialResult,
      sessionId,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      estimatedCost: metrics.estimatedCost,
      filesChanged: metrics.filesChanged,
      commandsRun: metrics.commandsRun,
      durationMs: metrics.durationMs,
      continuations: metrics.continuations,
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
        durationMs: metrics.durationMs,
        cost: metrics.estimatedCost,
        totalTurns,
        continuations: metrics.continuations,
      },
      'Claude execution exhausted all continuations',
    );

    return result;
  }

  /**
   * Handle normal completion
   */
  private handleCompletion(
    task: TaskSubmitPayload,
    tracker: ExecutionTracker,
    sessionId: string | null,
    resultText: string,
  ): ExecutionResult {
    const metrics = tracker.getMetrics();

    const result: ExecutionResult = {
      result: resultText || '(no output)',
      sessionId,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      estimatedCost: metrics.estimatedCost,
      filesChanged: metrics.filesChanged,
      commandsRun: metrics.commandsRun,
      durationMs: metrics.durationMs,
      continuations: metrics.continuations,
    };

    this.wsClient.send(
      createWSMessage(MessageType.TASK_COMPLETE, {
        taskId: task.taskId,
        ...result,
      }),
    );

    logger.info(
      {
        taskId: task.taskId,
        durationMs: metrics.durationMs,
        cost: metrics.estimatedCost,
        continuations: metrics.continuations,
      },
      'Claude execution completed',
    );

    return result;
  }

  /**
   * Handle execution error
   */
  private handleError(
    task: TaskSubmitPayload,
    tracker: ExecutionTracker,
    error: unknown,
    abortSignal?: AbortSignal,
  ): never {
    const metrics = tracker.getMetrics();
    const rawError = error instanceof Error ? error.message : String(error);
    const errorMessage = rawError;

    logger.error({ taskId: task.taskId, error: errorMessage, durationMs: metrics.durationMs }, 'Claude execution failed');

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
