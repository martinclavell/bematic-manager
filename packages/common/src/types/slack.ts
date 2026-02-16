export interface SlackContext {
  channelId: string;
  threadTs: string | null;
  userId: string;
  teamId?: string;
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
