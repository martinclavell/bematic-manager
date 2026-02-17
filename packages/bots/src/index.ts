// Base
export { BaseBotPlugin } from './base/base-bot.js';
export { BotRegistry } from './base/bot-registry.js';
export { parseCommandText } from './base/command-parser.js';
export * as ResponseBuilder from './base/response-builder.js';
export { routeToModel, resetRouterConfig } from './base/model-router.js';
export type { RoutingDecision, ModelRouterConfig } from './base/model-router.js';

// Bots
export { CoderBot } from './coder/coder.bot.js';
export { ReviewerBot } from './reviewer/reviewer.bot.js';
export { OpsBot } from './ops/ops.bot.js';
export { PlannerBot } from './planner/planner.bot.js';

// Convenience: register all bots
import { BotRegistry } from './base/bot-registry.js';
import { CoderBot } from './coder/coder.bot.js';
import { ReviewerBot } from './reviewer/reviewer.bot.js';
import { OpsBot } from './ops/ops.bot.js';
import { PlannerBot } from './planner/planner.bot.js';

export function registerAllBots(): void {
  BotRegistry.register(new CoderBot());
  BotRegistry.register(new ReviewerBot());
  BotRegistry.register(new OpsBot());
  BotRegistry.register(new PlannerBot());
}
