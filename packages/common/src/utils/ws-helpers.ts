import type { MessageType } from '../constants/message-types.js';
import type { WSMessage, MessagePayloadMap } from '../types/messages.js';
import { generateMessageId } from './ids.js';

/** Create a type-safe WebSocket message */
export function createWSMessage<T extends MessageType>(
  type: T,
  payload: MessagePayloadMap[T],
): WSMessage<T> {
  return {
    id: generateMessageId(),
    type,
    payload,
    timestamp: Date.now(),
  };
}

/** Serialize a WS message to JSON string */
export function serializeMessage(message: WSMessage): string {
  return JSON.stringify(message);
}

/** Parse a raw WS message string into a typed envelope */
export function parseMessage(raw: string): WSMessage {
  return JSON.parse(raw) as WSMessage;
}
