import { BotName, type BotCommand } from '@bematic/common';
import { BaseBotPlugin } from '../base/base-bot.js';

export class PlannerBot extends BaseBotPlugin {
  name = BotName.PLANNER;
  displayName = 'Planner';
  description = 'Project planning, task management, and reporting';
  slashCommand = '/bm-plan';
  defaultCommand = 'list';

  commands: BotCommand[] = [
    {
      name: 'create',
      description: 'Create a project plan or breakdown',
      aliases: ['plan', 'break', 'breakdown'],
      defaultPromptTemplate: 'Create a plan for: {args}',
    },
    {
      name: 'list',
      description: 'List project files, structure, or status',
      aliases: ['ls', 'show'],
      defaultPromptTemplate: 'List and describe: {args}',
    },
    {
      name: 'sprint',
      description: 'Plan or review a sprint',
      aliases: ['iteration'],
      defaultPromptTemplate: 'Plan the sprint: {args}',
    },
    {
      name: 'report',
      description: 'Generate a project report',
      aliases: ['summary', 'recap'],
      defaultPromptTemplate: 'Generate a report on: {args}',
    },
  ];

  protected getSystemPrompt(): string {
    return `You are a technical project manager. Your job is to analyze projects, create plans, and generate reports.

Rules:
- Read the project structure to understand scope
- Create clear, actionable task breakdowns
- Estimate complexity as: trivial, small, medium, large, epic
- DO NOT modify any files - only read and analyze
- Format output as structured lists with clear priorities`;
  }

  protected getAllowedTools(): string[] {
    return ['Read', 'Glob', 'Grep'];
  }
}
