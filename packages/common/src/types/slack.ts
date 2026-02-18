/** A file downloaded from Slack, base64-encoded for WS transmission */
export interface FileAttachment {
  name: string;
  mimetype: string;
  /** Base64-encoded file content */
  data: string;
  /** Original file size in bytes (before encoding) */
  size: number;
}

export interface SlackContext {
  channelId: string;
  threadTs: string | null;
  userId: string;
  teamId?: string;
  /** Timestamp of the user's original message (used for emoji reactions) */
  messageTs?: string | null;
  /** Extracted file/image attachment info to append to the prompt */
  fileInfo?: string | null;
  /** Downloaded file attachments */
  attachments?: FileAttachment[];
}

export interface SlackBlockMessage {
  channel: string;
  thread_ts?: string;
  blocks: SlackBlock[];
  text: string; // Fallback text
}

export type SlackBlock =
  | SlackSectionBlock
  | SlackDividerBlock
  | SlackContextBlock
  | SlackActionsBlock
  | SlackHeaderBlock;

export interface SlackSectionBlock {
  type: 'section';
  text: { type: 'mrkdwn' | 'plain_text'; text: string };
  accessory?: SlackBlockElement;
}

export interface SlackDividerBlock {
  type: 'divider';
}

export interface SlackContextBlock {
  type: 'context';
  elements: Array<{ type: 'mrkdwn' | 'plain_text'; text: string }>;
}

export interface SlackActionsBlock {
  type: 'actions';
  elements: SlackBlockElement[];
}

export interface SlackHeaderBlock {
  type: 'header';
  text: { type: 'plain_text'; text: string };
}

export interface SlackBlockElement {
  type: 'button';
  text: { type: 'plain_text'; text: string };
  action_id: string;
  value?: string;
  style?: 'primary' | 'danger';
}
