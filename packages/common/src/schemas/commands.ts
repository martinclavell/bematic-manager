import { z } from 'zod';

export const parsedCommandSchema = z.object({
  botName: z.string(),
  command: z.string(),
  args: z.string(),
  flags: z.record(z.union([z.string(), z.boolean()])),
  rawText: z.string(),
});

export const projectCreateSchema = z.object({
  name: z.string().min(1).max(100),
  slackChannelId: z.string().min(1),
  localPath: z.string().min(1),
  agentId: z.string().min(1),
  defaultModel: z.string().default('claude-sonnet-4-5-20250929'),
  defaultMaxBudget: z.number().positive().default(5.0),
});
