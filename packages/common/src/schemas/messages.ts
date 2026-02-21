import { z } from 'zod';
import { MessageType } from '../constants/message-types.js';

export const wsMessageEnvelopeSchema = z.object({
  id: z.string(),
  type: z.nativeEnum(MessageType),
  payload: z.unknown(),
  timestamp: z.number(),
});

export const authRequestSchema = z.object({
  agentId: z.string().min(1),
  apiKey: z.string().min(1),
  version: z.string(),
});

export const authResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  agentId: z.string().optional(),
});

const fileAttachmentSchema = z.object({
  name: z.string(),
  mimetype: z.string(),
  data: z.string(), // base64
  size: z.number(),
});

const attachmentResultSchema = z.object({
  name: z.string(),
  status: z.enum(['success', 'failed']),
  path: z.string().optional(),
  error: z.string().optional(),
  retries: z.number().optional(),
});

export const taskSubmitSchema = z.object({
  taskId: z.string(),
  projectId: z.string(),
  botName: z.string(),
  command: z.string(),
  prompt: z.string().min(1).max(100_000),
  systemPrompt: z.string(),
  localPath: z.string(),
  model: z.string(),
  maxBudget: z.number().positive(),
  allowedTools: z.array(z.string()),
  resumeSessionId: z.string().nullable().optional(),
  maxContinuations: z.number().int().min(0).optional(),
  parentTaskId: z.string().nullable().optional(),
  attachments: z.array(fileAttachmentSchema).optional(),
  slackContext: z.object({
    channelId: z.string(),
    threadTs: z.string().nullable(),
    userId: z.string(),
  }),
});

export const taskAckSchema = z.object({
  taskId: z.string(),
  accepted: z.boolean(),
  reason: z.string().optional(),
  queuePosition: z.number().optional(),
});

export const taskProgressSchema = z.object({
  taskId: z.string(),
  type: z.enum(['tool_use', 'thinking', 'info']),
  message: z.string(),
  timestamp: z.number(),
});

export const taskStreamSchema = z.object({
  taskId: z.string(),
  delta: z.string(),
  timestamp: z.number(),
});

export const taskCompleteSchema = z.object({
  taskId: z.string(),
  result: z.string(),
  sessionId: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  estimatedCost: z.number(),
  filesChanged: z.array(z.string()),
  commandsRun: z.array(z.string()),
  durationMs: z.number(),
  continuations: z.number().int().min(0).optional(),
  attachmentResults: z.array(attachmentResultSchema).optional(),
  model: z.string(),
});

export const taskErrorSchema = z.object({
  taskId: z.string(),
  error: z.string(),
  recoverable: z.boolean(),
  sessionId: z.string().nullable().optional(),
});

export const taskCancelSchema = z.object({
  taskId: z.string(),
  reason: z.string(),
});

// Inferred types for better TypeScript support
export type TaskAckData = z.infer<typeof taskAckSchema>;
export type TaskProgressData = z.infer<typeof taskProgressSchema>;
export type TaskStreamData = z.infer<typeof taskStreamSchema>;
export type TaskCompleteData = z.infer<typeof taskCompleteSchema>;
export type TaskErrorData = z.infer<typeof taskErrorSchema>;
export type TaskCancelData = z.infer<typeof taskCancelSchema>;
export type AuthRequestData = z.infer<typeof authRequestSchema>;
export type AuthResponseData = z.infer<typeof authResponseSchema>;
