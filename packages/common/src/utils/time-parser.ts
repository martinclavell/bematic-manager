import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';

/**
 * Parse natural language time expressions and convert to Date objects
 */
export class TimeParser {
  /**
   * Parse natural language time string with timezone support
   * Examples: "tomorrow 3pm", "in 2 hours", "2025-03-01 14:00"
   */
  static parseNatural(text: string, timezone: string = 'America/New_York'): Date | null {
    // First try parsing as ISO string
    const isoDate = this.parseISO(text, timezone);
    if (isoDate) {
      return isoDate;
    }

    // Use chrono-node for natural language parsing
    const referenceDate = DateTime.now().setZone(timezone).toJSDate();
    const parsed = chrono.parseDate(text, referenceDate);

    if (!parsed) {
      return null;
    }

    // Convert to timezone-aware date
    const dt = DateTime.fromJSDate(parsed).setZone(timezone);
    return dt.toJSDate();
  }

  /**
   * Parse ISO 8601 string with timezone
   */
  static parseISO(iso: string, timezone: string = 'America/New_York'): Date | null {
    try {
      // Try parsing as ISO 8601
      const dt = DateTime.fromISO(iso, { zone: timezone });
      if (dt.isValid) {
        return dt.toJSDate();
      }

      // Try parsing as SQL datetime
      const sqlDt = DateTime.fromSQL(iso, { zone: timezone });
      if (sqlDt.isValid) {
        return sqlDt.toJSDate();
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if parsed time is in the future
   */
  static isFuture(date: Date): boolean {
    return date.getTime() > Date.now();
  }

  /**
   * Format date to human-readable string with timezone
   */
  static format(date: Date, timezone: string = 'America/New_York'): string {
    const dt = DateTime.fromJSDate(date).setZone(timezone);
    return dt.toFormat('MMM d, yyyy h:mm a ZZZZ');
  }

  /**
   * Get relative time description (e.g., "in 2 hours", "tomorrow")
   */
  static relative(date: Date, timezone: string = 'America/New_York'): string {
    const dt = DateTime.fromJSDate(date).setZone(timezone);
    const now = DateTime.now().setZone(timezone);

    const diff = dt.diff(now, ['days', 'hours', 'minutes']).toObject();

    if (diff.days && diff.days >= 1) {
      const dayCount = Math.floor(diff.days);
      if (dayCount === 1) return 'tomorrow';
      return `in ${dayCount} days`;
    }

    if (diff.hours && diff.hours >= 1) {
      const hourCount = Math.floor(diff.hours);
      return `in ${hourCount} hour${hourCount > 1 ? 's' : ''}`;
    }

    if (diff.minutes && diff.minutes >= 1) {
      const minCount = Math.floor(diff.minutes);
      return `in ${minCount} minute${minCount > 1 ? 's' : ''}`;
    }

    return 'now';
  }

  /**
   * Validate that a time string can be parsed
   */
  static validate(text: string, timezone: string = 'America/New_York'): boolean {
    const parsed = this.parseNatural(text, timezone);
    return parsed !== null && this.isFuture(parsed);
  }
}
