/**
 * Tracks execution metrics across Claude invocations
 * - Token usage (input/output)
 * - Estimated costs
 * - Files changed
 * - Commands run
 * - Duration
 */
export class ExecutionTracker {
  private filesChanged = new Set<string>();
  private commandsRun = new Set<string>();
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCost = 0;
  private continuationCount = 0;
  private startTime = Date.now();

  /**
   * Track file modification (Edit, Write, NotebookEdit)
   */
  trackFileChange(filePath: string): void {
    this.filesChanged.add(filePath);
  }

  /**
   * Track command execution (Bash)
   */
  trackCommand(command: string): void {
    // Truncate long commands
    this.commandsRun.add(command.slice(0, 200));
  }

  /**
   * Add usage from a single invocation
   */
  addUsage(inputTokens: number, outputTokens: number, cost: number): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.totalCost += cost;
  }

  /**
   * Increment continuation counter
   */
  incrementContinuations(): void {
    this.continuationCount++;
  }

  /**
   * Get aggregated metrics
   */
  getMetrics() {
    return {
      filesChanged: Array.from(this.filesChanged),
      commandsRun: Array.from(this.commandsRun),
      inputTokens: this.totalInputTokens,
      outputTokens: this.totalOutputTokens,
      estimatedCost: this.totalCost,
      continuations: this.continuationCount,
      durationMs: Date.now() - this.startTime,
    };
  }

  // Expose sets for direct manipulation during invocation
  get files() {
    return this.filesChanged;
  }

  get commands() {
    return this.commandsRun;
  }
}
