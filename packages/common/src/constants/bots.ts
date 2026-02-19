export const BotName = {
  CODER: 'coder',
  REVIEWER: 'reviewer',
  OPS: 'ops',
  PLANNER: 'planner',
  NETSUITE: 'netsuite',
} as const;

export type BotName = (typeof BotName)[keyof typeof BotName];

export const BOT_KEYWORDS: Record<BotName, string[]> = {
  [BotName.CODER]: ['code', 'coder', 'fix', 'feature', 'refactor', 'implement'],
  [BotName.REVIEWER]: ['review', 'reviewer', 'diff', 'explain', 'security'],
  [BotName.OPS]: ['ops', 'build', 'deploy', 'status', 'logs', 'git'],
  [BotName.PLANNER]: ['plan', 'planner', 'sprint', 'report', 'create-task'],
  [BotName.NETSUITE]: ['netsuite', 'audit', 'seo', 'schema', 'crawl'],
};

// Main slash command - all functionality under /bm
export const MAIN_SLASH_COMMAND = '/bm';

// Legacy slash commands (deprecated, kept for backwards compatibility)
export const BOT_SLASH_COMMANDS: Record<string, BotName> = {
  '/bm-code': BotName.CODER,
  '/bm-review': BotName.REVIEWER,
  '/bm-ops': BotName.OPS,
  '/bm-plan': BotName.PLANNER,
  '/bm-netsuite': BotName.NETSUITE,
};

export const BOT_DEFAULT_BUDGETS: Record<BotName, number> = {
  [BotName.CODER]: 5.0,
  [BotName.REVIEWER]: 2.0,
  [BotName.OPS]: 1.0,
  [BotName.PLANNER]: 0.5,
  [BotName.NETSUITE]: 3.0,
};
