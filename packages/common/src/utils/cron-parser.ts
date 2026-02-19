import cronParser from 'cron-parser';
import { DateTime } from 'luxon';

/**
 * Parse and validate cron expressions
 */
export class CronParser {
  /**
   * Parse a cron expression
   * Format: "minute hour day month weekday"
   * Examples: "0 0 * * *" (daily at midnight), "0 9 * * MON" (Mondays at 9am)
   */
  static parse(expression: string, timezone: string = 'America/New_York'): cronParser.CronExpression {
    try {
      return cronParser.parseExpression(expression, {
        tz: timezone,
      });
    } catch (error) {
      throw new Error(`Invalid cron expression: ${expression}. ${error}`);
    }
  }

  /**
   * Get next execution time from cron expression
   */
  static getNext(expression: string, timezone: string = 'America/New_York'): Date {
    const interval = this.parse(expression, timezone);
    return interval.next().toDate();
  }

  /**
   * Get multiple next execution times
   */
  static getNextN(expression: string, count: number, timezone: string = 'America/New_York'): Date[] {
    const interval = this.parse(expression, timezone);
    const dates: Date[] = [];

    for (let i = 0; i < count; i++) {
      dates.push(interval.next().toDate());
    }

    return dates;
  }

  /**
   * Validate a cron expression
   */
  static validate(expression: string): boolean {
    try {
      cronParser.parseExpression(expression);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get human-readable description of cron expression
   * Note: This is a basic implementation. For production, consider using 'cronstrue' npm package
   */
  static describe(expression: string): string {
    try {
      const parts = expression.trim().split(/\s+/);
      if (parts.length !== 5) {
        return expression;
      }

      const [minute, hour, day, month, weekday] = parts;

      // Daily at specific time
      if (day === '*' && month === '*' && weekday === '*') {
        if (hour === '*' && minute === '*') {
          return 'Every minute';
        }
        if (hour !== '*' && minute !== '*') {
          return `Daily at ${hour}:${minute.padStart(2, '0')}`;
        }
        if (hour !== '*') {
          return `Every hour at minute ${minute}`;
        }
      }

      // Weekly on specific day
      if (day === '*' && month === '*' && weekday !== '*') {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = dayNames[parseInt(weekday)] || weekday;
        if (hour !== '*' && minute !== '*') {
          return `Every ${dayName} at ${hour}:${minute.padStart(2, '0')}`;
        }
        return `Every ${dayName}`;
      }

      // Monthly
      if (day !== '*' && month === '*' && weekday === '*') {
        if (hour !== '*' && minute !== '*') {
          return `Day ${day} of every month at ${hour}:${minute.padStart(2, '0')}`;
        }
        return `Day ${day} of every month`;
      }

      // Hourly
      if (hour === '*' && day === '*' && month === '*' && weekday === '*') {
        return `Every hour at minute ${minute}`;
      }

      // Fallback
      return expression;
    } catch {
      return expression;
    }
  }

  /**
   * Common cron presets
   */
  static readonly PRESETS = {
    HOURLY: '0 * * * *',
    DAILY: '0 0 * * *',
    WEEKLY: '0 0 * * 0',
    MONTHLY: '0 0 1 * *',
    YEARLY: '0 0 1 1 *',
    EVERY_15_MINUTES: '*/15 * * * *',
    EVERY_30_MINUTES: '*/30 * * * *',
    WEEKDAYS_9AM: '0 9 * * 1-5',
    WEEKENDS: '0 0 * * 0,6',
  } as const;

  /**
   * Validate cron won't run too frequently (prevent abuse)
   */
  static isReasonableFrequency(expression: string): boolean {
    try {
      const interval = this.parse(expression);
      const now = new Date();
      const next1 = interval.next().toDate();
      const next2 = interval.next().toDate();

      const diffMs = next2.getTime() - next1.getTime();
      const diffMinutes = diffMs / 1000 / 60;

      // Minimum 1 hour between executions (prevent abuse)
      return diffMinutes >= 60;
    } catch {
      return false;
    }
  }
}
