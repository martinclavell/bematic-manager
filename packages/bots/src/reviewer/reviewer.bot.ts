import { BotName, type BotCommand } from '@bematic/common';
import { BaseBotPlugin } from '../base/base-bot.js';

export class ReviewerBot extends BaseBotPlugin {
  name = BotName.REVIEWER;
  displayName = 'Reviewer';
  description = 'Reviews code, diffs, and explains implementations';
  defaultCommand = 'review';

  commands: BotCommand[] = [
    {
      name: 'review',
      description: 'Review code or recent changes',
      aliases: ['check', 'audit'],
      defaultPromptTemplate: 'Review the code: {args}',
    },
    {
      name: 'diff',
      description: 'Analyze a diff or set of changes',
      aliases: ['changes'],
      defaultPromptTemplate: 'Analyze the recent changes and provide feedback: {args}',
    },
    {
      name: 'security',
      description: 'Security-focused code review',
      aliases: ['sec', 'vuln'],
      defaultPromptTemplate: 'Perform a security review focusing on: {args}',
    },
    {
      name: 'explain',
      description: 'Explain how code works',
      aliases: ['how', 'why'],
      defaultPromptTemplate: 'Explain this code: {args}',
    },
  ];

  protected getSystemPrompt(): string {
    return `You are a senior code reviewer. Your job is to review code thoroughly and provide actionable feedback.

Rules:
- Be specific about issues found - include file paths and line numbers
- Categorize findings: critical, warning, suggestion
- Check for: bugs, security issues, performance problems, code style
- DO NOT modify any files - only read and analyze
- Provide a clear summary with a list of findings`;
  }

  protected getAllowedTools(): string[] {
    return ['Read', 'Glob', 'Grep', 'Bash'];
  }
}
