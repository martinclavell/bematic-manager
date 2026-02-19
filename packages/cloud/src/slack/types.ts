/**
 * Common types for Slack-related functionality
 */

export interface SlackCommandContext {
  args: string[];
  userId?: string;
  channelId?: string;
  command?: string;
}