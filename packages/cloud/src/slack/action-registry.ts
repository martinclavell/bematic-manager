import type { ActionType, ActionResult } from '@bematic/common';
import { createLogger } from '@bematic/common';

const logger = createLogger('action-registry');

/**
 * Handler function for an interactive action
 */
export type ActionHandler = (context: {
  actionId: string;
  userId: string;
  channelId: string;
  threadTs?: string | null;
  messageTs?: string | null;
  taskId?: string;
  metadata?: Record<string, any>;
  value?: string;
}) => Promise<ActionResult>;

/**
 * Action definition with metadata
 */
interface ActionDefinition {
  type: ActionType;
  handler: ActionHandler;
  /** Human-readable description */
  description?: string;
  /** Whether to require confirmation before executing */
  requireConfirmation?: boolean;
  /** Confirmation dialog text */
  confirmationText?: string;
  /** Expiration time in milliseconds (default: 24 hours) */
  expirationMs?: number;
}

/**
 * Central registry for interactive action handlers
 * Similar to BotRegistry but for Slack button actions
 */
export class ActionRegistry {
  private static actions = new Map<ActionType, ActionDefinition>();

  /**
   * Register an action handler
   */
  static register(definition: ActionDefinition): void {
    if (this.actions.has(definition.type)) {
      logger.warn({ type: definition.type }, 'Action type already registered, overwriting');
    }
    this.actions.set(definition.type, definition);
    logger.info({ type: definition.type }, 'Action handler registered');
  }

  /**
   * Get action definition
   */
  static get(type: ActionType): ActionDefinition | undefined {
    return this.actions.get(type);
  }

  /**
   * Check if action type is registered
   */
  static has(type: ActionType): boolean {
    return this.actions.has(type);
  }

  /**
   * Execute an action handler
   */
  static async execute(
    type: ActionType,
    context: Parameters<ActionHandler>[0]
  ): Promise<ActionResult> {
    const definition = this.actions.get(type);
    if (!definition) {
      logger.error({ type }, 'Action type not registered');
      return {
        success: false,
        message: 'Unknown action type',
        ephemeral: true,
      };
    }

    try {
      logger.info({ type, userId: context.userId }, 'Executing action handler');
      const result = await definition.handler(context);
      logger.info({ type, success: result.success }, 'Action handler executed');
      return result;
    } catch (error) {
      logger.error({ error, type }, 'Action handler threw error');
      return {
        success: false,
        message: 'Failed to process action',
        ephemeral: true,
      };
    }
  }

  /**
   * Get all registered action types
   */
  static getAll(): ActionType[] {
    return Array.from(this.actions.keys());
  }

  /**
   * Clear all registered actions (for testing)
   */
  static clear(): void {
    this.actions.clear();
  }
}
