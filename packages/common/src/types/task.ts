import type { BotName } from '../constants/bots.js';

export const TaskStatus = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export interface Task {
  id: string;
  projectId: string;
  botName: BotName;
  command: string;
  prompt: string;
  status: TaskStatus;
  result: string | null;
  errorMessage: string | null;
  slackChannelId: string;
  slackThreadTs: string | null;
  slackUserId: string;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  maxBudget: number;
  filesChanged: string[];
  commandsRun: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface TaskSubmitPayload {
  taskId: string;
  projectId: string;
  botName: BotName;
  command: string;
  prompt: string;
  systemPrompt: string;
  localPath: string;
  model: string;
  maxBudget: number;
  allowedTools: string[];
  resumeSessionId?: string | null;
  /** Max auto-continuations when Claude hits turn limit (0 = disabled) */
  maxContinuations?: number;
  /** Parent task ID when this is a subtask from decomposition */
  parentTaskId?: string | null;
  /** Whether to automatically commit and push changes after completion */
  autoCommitPush?: boolean;
  /** File attachments from Slack (base64-encoded) */
  attachments?: Array<{
    name: string;
    mimetype: string;
    data: string;
    size: number;
  }>;
  slackContext: {
    channelId: string;
    threadTs: string | null;
    userId: string;
  };
}

export interface TaskProgressPayload {
  taskId: string;
  type: 'tool_use' | 'thinking' | 'info';
  message: string;
  timestamp: number;
}

export interface TaskStreamPayload {
  taskId: string;
  delta: string;
  timestamp: number;
}

export interface AttachmentResult {
  name: string;
  status: 'success' | 'failed';
  path?: string;
  error?: string;
  retries?: number;
}

export interface TaskCompletePayload {
  taskId: string;
  result: string;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  filesChanged: string[];
  commandsRun: string[];
  durationMs: number;
  /** Number of auto-continuations that were performed (0 = completed in one shot) */
  continuations?: number;
  /** Attachment processing results */
  attachmentResults?: AttachmentResult[];
}

export interface TaskErrorPayload {
  taskId: string;
  error: string;
  recoverable: boolean;
  sessionId?: string | null;
}

export interface TaskCancelPayload {
  taskId: string;
  reason: string;
}
