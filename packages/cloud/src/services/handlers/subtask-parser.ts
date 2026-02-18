import { createLogger, type SubtaskDefinition } from '@bematic/common';

const logger = createLogger('subtask-parser');

/**
 * Parses subtask definitions from Claude's planning output
 * Supports:
 * - Explicit ```json:subtasks marker
 * - Fallback to any JSON array in the text
 */
export class SubtaskParser {
  /**
   * Parse subtasks from a planning result text
   * Returns empty array if parsing fails
   */
  parse(result: string): SubtaskDefinition[] {
    try {
      // Look for JSON block with the ```json:subtasks marker
      const jsonMatch = result.match(/```json:subtasks\s*\n([\s\S]*?)```/);
      if (jsonMatch?.[1]) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (Array.isArray(parsed)) {
          return this.filterValidSubtasks(parsed);
        }
      }

      // Fallback: try to find any JSON array in the result
      const arrayMatch = result.match(/\[\s*\{[\s\S]*?\}\s*\]/);
      if (arrayMatch) {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed)) {
          return this.filterValidSubtasks(parsed);
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to parse subtasks from planning result');
    }

    return [];
  }

  /**
   * Filter out invalid subtask entries
   */
  private filterValidSubtasks(items: any[]): SubtaskDefinition[] {
    return items.filter(
      (item): item is SubtaskDefinition =>
        typeof item.title === 'string' &&
        typeof item.prompt === 'string' &&
        typeof item.command === 'string',
    );
  }
}
