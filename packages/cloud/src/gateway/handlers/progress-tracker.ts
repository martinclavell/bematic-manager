/**
 * Tracks progress messages per task for updating instead of posting new ones
 */
export class ProgressTracker {
  messageTs: string | null = null;
  steps: string[] = [];

  addStep(step: string): void {
    this.steps.push(step);
  }

  setMessageTs(ts: string): void {
    this.messageTs = ts;
  }

  getStepsFormatted(): string {
    return this.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  }

  hasMessage(): boolean {
    return this.messageTs !== null;
  }
}

/**
 * Manages progress trackers for all tasks
 */
export class ProgressTrackerManager {
  private trackers = new Map<string, ProgressTracker>();

  getOrCreate(taskId: string): ProgressTracker {
    let tracker = this.trackers.get(taskId);
    if (!tracker) {
      tracker = new ProgressTracker();
      this.trackers.set(taskId, tracker);
    }
    return tracker;
  }

  get(taskId: string): ProgressTracker | undefined {
    return this.trackers.get(taskId);
  }

  delete(taskId: string): void {
    this.trackers.delete(taskId);
  }

  has(taskId: string): boolean {
    return this.trackers.has(taskId);
  }
}
