/**
 * Test logger utility for capturing and asserting log messages during tests.
 * Provides methods to capture log output and make assertions about what was logged.
 *
 * @example
 * ```typescript
 * const logger = new TestLogger();
 *
 * // Use in your code
 * logger.info('Processing started');
 * logger.error('Something went wrong', { userId: 123 });
 *
 * // Assert in tests
 * logger.assertLogged('info', 'Processing started');
 * logger.assertLogged('error', /Something went wrong/);
 * expect(logger.getLogs('error')).toHaveLength(1);
 * ```
 */

export interface LogEntry {
  level: string;
  message: string;
  context?: any;
  timestamp: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'audit';

export class TestLogger {
  private logs: LogEntry[] = [];

  /**
   * Log a debug message
   * @param message Log message
   * @param context Optional context object
   */
  debug(message: string, context?: any): void {
    this.log('debug', message, context);
  }

  /**
   * Log an info message
   * @param message Log message
   * @param context Optional context object
   */
  info(message: string, context?: any): void {
    this.log('info', message, context);
  }

  /**
   * Log a warning message
   * @param message Log message
   * @param context Optional context object
   */
  warn(message: string, context?: any): void {
    this.log('warn', message, context);
  }

  /**
   * Log an error message
   * @param message Log message
   * @param context Optional context object
   */
  error(message: string, context?: any): void {
    this.log('error', message, context);
  }

  /**
   * Log an audit message
   * @param message Log message
   * @param context Optional context object
   */
  audit(message: string, context?: any): void {
    this.log('audit', message, context);
  }

  /**
   * Log a message with specified level
   * @param level Log level
   * @param message Log message
   * @param context Optional context object
   */
  private log(level: string, message: string, context?: any): void {
    this.logs.push({
      level,
      message,
      context,
      timestamp: Date.now()
    });
  }

  /**
   * Clear all captured logs
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * Get all captured logs
   * @param level Optional level to filter by
   * @returns Array of log entries
   */
  getLogs(level?: string): LogEntry[] {
    if (level) {
      return this.logs.filter(log => log.level === level);
    }
    return [...this.logs];
  }

  /**
   * Get logs within a time range
   * @param startTime Start timestamp (inclusive)
   * @param endTime End timestamp (inclusive)
   * @returns Array of log entries within the time range
   */
  getLogsInRange(startTime: number, endTime: number): LogEntry[] {
    return this.logs.filter(
      log => log.timestamp >= startTime && log.timestamp <= endTime
    );
  }

  /**
   * Get the most recent log entry
   * @param level Optional level to filter by
   * @returns Most recent log entry or undefined
   */
  getLastLog(level?: string): LogEntry | undefined {
    const filtered = level ? this.logs.filter(log => log.level === level) : this.logs;
    return filtered[filtered.length - 1];
  }

  /**
   * Get the first log entry
   * @param level Optional level to filter by
   * @returns First log entry or undefined
   */
  getFirstLog(level?: string): LogEntry | undefined {
    const filtered = level ? this.logs.filter(log => log.level === level) : this.logs;
    return filtered[0];
  }

  /**
   * Get count of logs by level
   * @param level Log level to count
   * @returns Number of logs at specified level
   */
  getLogCount(level?: string): number {
    return this.getLogs(level).length;
  }

  /**
   * Assert that a message was logged at specified level
   * @param level Log level
   * @param messagePattern String or RegExp to match against
   * @throws Error if assertion fails
   *
   * @example
   * ```typescript
   * logger.assertLogged('info', 'User logged in');
   * logger.assertLogged('error', /failed to connect/i);
   * ```
   */
  assertLogged(level: string, messagePattern: string | RegExp): void {
    const logs = this.getLogs(level);
    const pattern = typeof messagePattern === 'string'
      ? messagePattern
      : messagePattern;

    const found = logs.some(log => {
      if (typeof pattern === 'string') {
        return log.message === pattern;
      } else {
        return pattern.test(log.message);
      }
    });

    if (!found) {
      const messages = logs.map(log => log.message);
      throw new Error(
        `Expected log message matching '${messagePattern}' at level '${level}', but not found. ` +
        `Found messages at this level: ${JSON.stringify(messages)}`
      );
    }
  }

  /**
   * Assert that a message was NOT logged at specified level
   * @param level Log level
   * @param messagePattern String or RegExp to match against
   * @throws Error if assertion fails
   */
  assertNotLogged(level: string, messagePattern: string | RegExp): void {
    const logs = this.getLogs(level);
    const pattern = typeof messagePattern === 'string'
      ? messagePattern
      : messagePattern;

    const found = logs.some(log => {
      if (typeof pattern === 'string') {
        return log.message === pattern;
      } else {
        return pattern.test(log.message);
      }
    });

    if (found) {
      throw new Error(
        `Expected log message matching '${messagePattern}' NOT to be logged at level '${level}', but it was found`
      );
    }
  }

  /**
   * Assert that a specific number of messages were logged at specified level
   * @param level Log level
   * @param expectedCount Expected number of log messages
   * @throws Error if assertion fails
   */
  assertLogCount(level: string, expectedCount: number): void {
    const actualCount = this.getLogCount(level);
    if (actualCount !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} log messages at level '${level}', but found ${actualCount}`
      );
    }
  }

  /**
   * Assert that logs were captured in a specific order
   * @param expectedSequence Array of {level, message} objects in expected order
   * @throws Error if assertion fails
   */
  assertLogSequence(expectedSequence: Array<{ level: string; message: string | RegExp }>): void {
    if (this.logs.length < expectedSequence.length) {
      throw new Error(
        `Expected at least ${expectedSequence.length} log entries, but only found ${this.logs.length}`
      );
    }

    for (let i = 0; i < expectedSequence.length; i++) {
      const expected = expectedSequence[i];
      const actual = this.logs[i];

      if (actual.level !== expected.level) {
        throw new Error(
          `Expected log ${i} to have level '${expected.level}', but found '${actual.level}'`
        );
      }

      const messageMatches = typeof expected.message === 'string'
        ? actual.message === expected.message
        : expected.message.test(actual.message);

      if (!messageMatches) {
        throw new Error(
          `Expected log ${i} message to match '${expected.message}', but found '${actual.message}'`
        );
      }
    }
  }

  /**
   * Assert that logs contain specific context data
   * @param level Log level
   * @param contextMatcher Partial object or function to match context
   * @throws Error if assertion fails
   */
  assertLogContext(
    level: string,
    contextMatcher: Record<string, any> | ((context: any) => boolean)
  ): void {
    const logs = this.getLogs(level);

    const found = logs.some(log => {
      if (!log.context) {
        return false;
      }

      if (typeof contextMatcher === 'function') {
        return contextMatcher(log.context);
      }

      // Check if all properties in contextMatcher exist in log.context
      return Object.entries(contextMatcher).every(
        ([key, value]) => log.context[key] === value
      );
    });

    if (!found) {
      throw new Error(
        `Expected to find log at level '${level}' with matching context, but none found`
      );
    }
  }

  /**
   * Get logs that match a specific context pattern
   * @param level Log level to filter by
   * @param contextMatcher Partial object or function to match context
   * @returns Array of matching log entries
   */
  getLogsWithContext(
    level: string,
    contextMatcher: Record<string, any> | ((context: any) => boolean)
  ): LogEntry[] {
    const logs = this.getLogs(level);

    return logs.filter(log => {
      if (!log.context) {
        return false;
      }

      if (typeof contextMatcher === 'function') {
        return contextMatcher(log.context);
      }

      return Object.entries(contextMatcher).every(
        ([key, value]) => log.context[key] === value
      );
    });
  }

  /**
   * Create a snapshot of current logs for later comparison
   * @returns Snapshot object
   */
  createSnapshot(): LogEntry[] {
    return this.logs.map(log => ({ ...log }));
  }

  /**
   * Get logs that were added since a snapshot was taken
   * @param snapshot Previously created snapshot
   * @returns Array of new log entries
   */
  getLogsSince(snapshot: LogEntry[]): LogEntry[] {
    const snapshotLength = snapshot.length;
    return this.logs.slice(snapshotLength);
  }

  /**
   * Format logs as a readable string for debugging
   * @param level Optional level to filter by
   * @returns Formatted log string
   */
  formatLogs(level?: string): string {
    const logs = this.getLogs(level);

    return logs.map(log => {
      const timestamp = new Date(log.timestamp).toISOString();
      const context = log.context ? ` ${JSON.stringify(log.context)}` : '';
      return `[${timestamp}] ${log.level.toUpperCase()}: ${log.message}${context}`;
    }).join('\n');
  }

  /**
   * Create a console-compatible logger that captures output
   * @returns Object with console methods that capture to this logger
   */
  createConsoleCapture(): {
    log: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
  } {
    return {
      log: (message: string, ...args: any[]) => {
        this.info(message, args.length > 0 ? args : undefined);
      },
      info: (message: string, ...args: any[]) => {
        this.info(message, args.length > 0 ? args : undefined);
      },
      warn: (message: string, ...args: any[]) => {
        this.warn(message, args.length > 0 ? args : undefined);
      },
      error: (message: string, ...args: any[]) => {
        this.error(message, args.length > 0 ? args : undefined);
      },
      debug: (message: string, ...args: any[]) => {
        this.debug(message, args.length > 0 ? args : undefined);
      }
    };
  }

  /**
   * Export logs in JSON format
   * @returns JSON string of all logs
   */
  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Import logs from JSON format
   * @param jsonLogs JSON string of logs to import
   * @param append Whether to append to existing logs or replace them
   */
  importLogs(jsonLogs: string, append = false): void {
    const importedLogs = JSON.parse(jsonLogs) as LogEntry[];

    if (append) {
      this.logs.push(...importedLogs);
    } else {
      this.logs = importedLogs;
    }
  }
}