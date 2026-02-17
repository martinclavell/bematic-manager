import { BotName, type BotCommand, type BotExecutionConfig, type ParsedCommand } from '@bematic/common';
import { BaseBotPlugin } from '../base/base-bot.js';

/** Commands that are complex enough to benefit from decomposition */
const DECOMPOSABLE_COMMANDS = new Set(['feature', 'add', 'implement', 'create', 'refactor', 'cleanup', 'improve']);

/** Minimum args length to trigger decomposition (short tasks don't need it) */
const MIN_DECOMPOSE_ARGS_LENGTH = 100;

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

  shouldDecompose(command: ParsedCommand): boolean {
    // Explicit flag overrides
    if (command.flags['decompose'] === true) return true;
    if (command.flags['no-decompose'] === true) return false;

    // Only decompose complex commands with long descriptions
    return (
      DECOMPOSABLE_COMMANDS.has(command.command) &&
      command.args.length >= MIN_DECOMPOSE_ARGS_LENGTH
    );
  }

  buildDecompositionConfig(
    command: ParsedCommand,
    projectContext: { name: string; localPath: string; defaultModel: string; defaultMaxBudget: number },
  ): BotExecutionConfig | null {
    if (!this.shouldDecompose(command)) return null;

    const model =
      (command.flags['model'] as string | undefined) ?? projectContext.defaultModel;

    const planningPrompt = `You are a technical planner. Analyze this task and break it down into smaller, independently executable subtasks.

## Task to decompose
${command.args}

## Project context
- Project: ${projectContext.name}
- Path: ${projectContext.localPath}

## Instructions
1. First, READ the project structure to understand the codebase (use Glob and Read tools)
2. Then break the task into 2-5 focused subtasks that can each be completed independently
3. Each subtask should be self-contained and completable in under 200 tool calls
4. Order subtasks logically (dependencies first)
5. DO NOT implement anything — only plan

## Required output format
After your analysis, output EXACTLY this JSON block (no other text after it):

\`\`\`json:subtasks
[
  {
    "title": "Short title for this subtask",
    "prompt": "Detailed implementation prompt with specific file paths and requirements",
    "command": "feature"
  }
]
\`\`\`

The "command" field should be one of: fix, feature, refactor, test.
Each "prompt" should be detailed enough for an engineer to implement without additional context.`;

    return {
      systemPrompt: 'You are a technical planner for a software project. Your job is to analyze tasks and break them into smaller subtasks. You must NOT modify any files — only read and analyze.',
      prompt: planningPrompt,
      model,
      maxBudget: Math.min(projectContext.defaultMaxBudget * 0.2, 1.0), // Planning is cheap
      allowedTools: ['Read', 'Glob', 'Grep'], // Read-only tools for planning
    };
  }
}
