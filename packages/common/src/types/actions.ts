/**
 * Interactive action types for Slack buttons and user interactions
 */

export type ActionType =
  | 'retry_task'
  | 'cancel_task'
  | 'approve_plan'
  | 'request_changes'
  | 'cancel_plan'
  | 'feedback_positive'
  | 'feedback_negative'
  | 'feedback_suggest'
  | 'confirm_action'
  | 'reject_action'
  | 'navigation_next'
  | 'navigation_previous'
  | 'navigation_skip';

/**
 * Context data for an interactive action
 */
export interface ActionContext {
  /** Unique identifier for this action instance */
  actionId: string;
  /** Type of action */
  type: ActionType;
  /** Task ID this action relates to (if applicable) */
  taskId?: string;
  /** User who triggered the action */
  userId: string;
  /** Channel where action was triggered */
  channelId: string;
  /** Thread timestamp */
  threadTs?: string | null;
  /** Arbitrary metadata specific to the action type */
  metadata?: Record<string, any>;
  /** When this action expires (optional) */
  expiresAt?: Date;
  /** When this action was created */
  createdAt: Date;
}

/**
 * Result of handling an action
 */
export interface ActionResult {
  /** Whether the action was handled successfully */
  success: boolean;
  /** Message to show to user */
  message?: string;
  /** Whether to update the original message */
  updateOriginal?: boolean;
  /** New blocks to replace the original message with */
  newBlocks?: any[];
  /** Whether to show message ephemerally (only to user who clicked) */
  ephemeral?: boolean;
}

/**
 * Feedback suggestion submitted by user
 */
export interface FeedbackSuggestion {
  id: string;
  userId: string;
  taskId?: string;
  botName?: string;
  category: 'response_quality' | 'code_quality' | 'documentation' | 'performance' | 'other';
  suggestion: string;
  context?: string;
  status: 'pending' | 'reviewed' | 'applied' | 'rejected';
  createdAt: Date;
  reviewedAt?: Date;
  appliedAt?: Date;
}

/**
 * Aggregated feedback analysis
 */
export interface FeedbackAnalysis {
  /** Common themes found across suggestions */
  themes: Array<{
    theme: string;
    count: number;
    examples: string[];
  }>;
  /** Suggested improvements derived from feedback */
  improvements: Array<{
    category: string;
    priority: 'high' | 'medium' | 'low';
    description: string;
    relatedSuggestions: string[];
  }>;
  /** Total suggestions analyzed */
  totalSuggestions: number;
  /** Date range of analysis */
  analyzedFrom: Date;
  analyzedTo: Date;
}
