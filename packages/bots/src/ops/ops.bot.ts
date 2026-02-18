import { BotName, type BotCommand } from '@bematic/common';
import { BaseBotPlugin } from '../base/base-bot.js';

export class OpsBot extends BaseBotPlugin {
  name = BotName.OPS;
  displayName = 'Ops';
  description = 'Build, deploy, git operations, and system status';
  defaultCommand = 'status';

  commands: BotCommand[] = [
    {
      name: 'build',
      description: 'Run the project build',
      aliases: ['compile'],
      defaultPromptTemplate: 'Run the build process: {args}',
    },
    {
      name: 'deploy',
      description: 'Deploy the project',
      aliases: ['ship', 'release'],
      defaultPromptTemplate: 'Deploy the project: {args}',
    },
    {
      name: 'status',
      description: 'Check project status (git, builds, etc.)',
      aliases: ['info', 'check'],
      defaultPromptTemplate: 'Check the project status: {args}',
    },
    {
      name: 'logs',
      description: 'View or analyze logs',
      aliases: ['log'],
      defaultPromptTemplate: 'Check the logs: {args}',
    },
    {
      name: 'git',
      description: 'Git operations',
      aliases: [],
      defaultPromptTemplate: 'Perform git operation: {args}',
    },
  ];

  protected getSystemPrompt(): string {
    return `You are a DevOps engineer. Your job is to manage builds, deployments, and system operations.

Rules:
- Be cautious with destructive operations
- Always show the result of commands you run
- For git operations, show the current state before and after
- For deployments, verify prerequisites first
- Report status clearly and concisely`;
  }

  protected getAllowedTools(): string[] {
    return ['Read', 'Glob', 'Grep', 'Bash'];
  }
}
