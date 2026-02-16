import type { BotName } from '../constants/bots.js';
import type { SlackBlock } from './slack.js';
import type { TaskCompletePayload } from './task.js';

export interface BotCommand {
  name: string;
  description: string;
  aliases: string[];
  defaultPromptTemplate: string;
}

export interface ParsedCommand {
  botName: BotName;
  command: string;
  args: string;
  flags: Record<string, string | boolean>;
  rawText: string;
}

export interface BotExecutionConfig {
  systemPrompt: string;
  prompt: string;
  model: string;
  maxBudget: number;
  allowedTools: string[];
}

export interface BotPlugin {
  name: BotName;
  displayName: string;
  description: string;
  slashCommand: string;
  commands: BotCommand[];
  defaultCommand: string;

  /** Parse raw text after bot keyword into a structured command */
  parseCommand(text: string): ParsedCommand;

  /** Build the Claude execution config for a parsed command */
  buildExecutionConfig(
    command: ParsedCommand,
    projectContext: { name: string; localPath: string; defaultModel: string; defaultMaxBudget: number },
  ): BotExecutionConfig;

  /** Format a completed task result into Slack blocks */
  formatResult(result: TaskCompletePayload): SlackBlock[];

  /** Format an error into Slack blocks */
  formatError(error: string, taskId: string): SlackBlock[];
}
