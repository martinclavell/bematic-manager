/**
 * Type definitions for Claude SDK messages to replace 'as any' usage
 */

// Base message interface
export interface SDKBaseMessage {
  type: string;
}

// System message with init subtype
export interface SDKSystemMessage extends SDKBaseMessage {
  type: 'system';
  subtype?: 'init';
  session_id?: string;
}

// Result message interface
export interface SDKResultMessage extends SDKBaseMessage {
  type: 'result';
  session_id?: string;
  subtype: 'success' | 'error';
  result?: string;
  is_error: boolean;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Assistant message interface
export interface SDKAssistantMessage extends SDKBaseMessage {
  type: 'assistant';
  message?: {
    content?: Array<{
      type: 'text' | 'tool_use';
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

// Union type for all possible SDK messages
export type SDKMessage = SDKSystemMessage | SDKResultMessage | SDKAssistantMessage | SDKBaseMessage;

/**
 * Type guard for system messages with init subtype
 */
export function isSystemInitMessage(message: unknown): message is SDKSystemMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'system' &&
    'subtype' in message &&
    (message as any).subtype === 'init'
  );
}

/**
 * Type guard for result messages
 */
export function isResultMessage(message: unknown): message is SDKResultMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'result'
  );
}

/**
 * Type guard for assistant messages
 */
export function isAssistantMessage(message: unknown): message is SDKAssistantMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'assistant'
  );
}

/**
 * Safely extract session ID from system or result messages
 */
export function extractSessionId(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const msg = message as any;
  return typeof msg.session_id === 'string' ? msg.session_id : null;
}

/**
 * Safely extract result text from result messages
 */
export function extractResultText(message: unknown): string {
  if (!isResultMessage(message)) {
    return '';
  }

  if (message.subtype === 'success') {
    return message.result || '';
  } else {
    return message.result || message.subtype || '';
  }
}

/**
 * Check if assistant message has text content
 */
export function hasTextContent(message: SDKAssistantMessage): boolean {
  return !!(
    message.message?.content?.some(
      (block) => block.type === 'text' && block.text
    )
  );
}

/**
 * Type-safe query options interface
 */
export interface QueryOptions {
  customSystemPrompt?: string;
  model?: string;
  maxTurns?: number;
  cwd?: string;
  allowedTools?: string[];
  abortController?: AbortController;
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  env?: Record<string, string>;
  stderr?: (data: string) => void;
  resume?: string;
}