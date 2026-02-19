/**
 * Type definitions for Slack API structures to replace 'as any' usage
 */

export interface SlackFile {
  url_private_download?: string;
  url_private: string;
  name: string;
  mimetype: string;
  filetype: string;
  size?: number;
}

export interface SlackMessage {
  user: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  text?: string;
  subtype?: string;
  files?: SlackFile[];
}

export interface SlackEvent {
  type: string;
  user?: string;
  channel: string;
  ts: string;
  text?: string;
  files?: SlackFile[];
}

export interface SlackCommand {
  user_id: string;
  channel_id: string;
  text: string;
}

/**
 * Type guard to check if a message has files
 */
export function hasFiles(message: unknown): message is { files: SlackFile[] } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'files' in message &&
    Array.isArray((message as any).files)
  );
}

/**
 * Type guard to check if a message has a thread_ts
 */
export function hasThreadTs(message: unknown): message is { thread_ts: string } {
  return (
    typeof message === 'object' &&
    message !== null &&
    'thread_ts' in message &&
    typeof (message as any).thread_ts === 'string'
  );
}

/**
 * Safely extract files from a Slack message or event
 */
export function extractFiles(messageOrEvent: unknown): SlackFile[] {
  if (!hasFiles(messageOrEvent)) {
    return [];
  }
  return messageOrEvent.files.filter((file): file is SlackFile =>
    typeof file === 'object' &&
    file !== null &&
    typeof file.name === 'string' &&
    typeof file.mimetype === 'string'
  );
}

/**
 * Safely extract thread timestamp from a Slack message
 */
export function extractThreadTs(message: unknown): string | undefined {
  if (!hasThreadTs(message)) {
    return undefined;
  }
  return message.thread_ts;
}