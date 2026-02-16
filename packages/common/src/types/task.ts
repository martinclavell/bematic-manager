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

export interface TaskCompletePayload {
  taskId: string;
  result: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  filesChanged: string[];
  commandsRun: string[];
  durationMs: number;
}

export interface TaskErrorPayload {
  taskId: string;
  error: string;
  recoverable: boolean;
}

export interface TaskCancelPayload {
  taskId: string;
  reason: string;
}
