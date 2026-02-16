import { BotName, type BotCommand } from '@bematic/common';
import { BaseBotPlugin } from '../base/base-bot.js';

export class CoderBot extends BaseBotPlugin {
  name = BotName.CODER;
  displayName = 'Coder';
  description = 'Writes, fixes, and refactors code';
  slashCommand = '/bm-code';
  defaultCommand = 'fix';

  commands: BotCommand[] = [
    {
      name: 'fix',
      description: 'Fix a bug or issue',
      aliases: ['bugfix', 'debug'],
      defaultPromptTemplate: 'Find and fix this issue: {args}',
    },
    {
      name: 'feature',
      description: 'Implement a new feature',
      aliases: ['add', 'implement', 'create'],
      defaultPromptTemplate: 'Implement this feature: {args}',
    },
    {
      name: 'refactor',
      description: 'Refactor existing code',
      aliases: ['cleanup', 'improve'],
      defaultPromptTemplate: 'Refactor the following: {args}',
    },
    {
      name: 'test',
      description: 'Write or fix tests',
      aliases: ['tests'],
      defaultPromptTemplate: 'Write tests for: {args}',
    },
  ];

  protected getSystemPrompt(): string {
    return `You are a senior software engineer. Your job is to write clean, correct, production-quality code.

Rules:
- Read existing code before making changes
- Follow the project's existing patterns and conventions
- Write minimal, focused changes - only what's needed
- If writing tests, use the project's existing test framework
- Provide a brief summary of what you changed and why`;
  }

  protected getAllowedTools(): string[] {
    return ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'NotebookEdit'];
  }
}
