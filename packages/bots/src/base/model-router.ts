import {
  ModelTier,
  DEFAULT_TIER_MODELS,
  BOT_TIER_BIAS,
  COMMAND_TIER_WEIGHT,
  PROMPT_LENGTH_THRESHOLDS,
  TIER_SCORE_BOUNDARIES,
  createLogger,
  type ParsedCommand,
} from '@bematic/common';

const logger = createLogger('model-router');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Breakdown of how the router scored a task */
export interface RoutingDecision {
  /** The tier that was selected */
  tier: ModelTier;
  /** The concrete model ID to use */
  model: string;
  /** The raw numeric score before tier mapping */
  score: number;
  /** Human-readable reason for the decision */
  reason: string;
  /** Whether an explicit --model flag overrode the routing */
  overridden: boolean;
}

/** Environment-driven config for the router */
export interface ModelRouterConfig {
  /** Master switch — when false the router always returns the project default */
  enabled: boolean;
  /** Override the default model ID per tier (e.g. swap in a fine-tuned variant) */
  tierModels: Record<ModelTier, string>;
}

// ---------------------------------------------------------------------------
// Configuration (read once from env, cached)
// ---------------------------------------------------------------------------

let cachedConfig: ModelRouterConfig | null = null;

function loadConfig(): ModelRouterConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    enabled: process.env['MODEL_ROUTING_ENABLED'] !== 'false', // on by default
    tierModels: {
      [ModelTier.LITE]:
        process.env['MODEL_TIER_LITE'] ?? DEFAULT_TIER_MODELS[ModelTier.LITE],
      [ModelTier.STANDARD]:
        process.env['MODEL_TIER_STANDARD'] ?? DEFAULT_TIER_MODELS[ModelTier.STANDARD],
      [ModelTier.PREMIUM]:
        process.env['MODEL_TIER_PREMIUM'] ?? DEFAULT_TIER_MODELS[ModelTier.PREMIUM],
    },
  };

  return cachedConfig;
}

/** Reset cached config (useful for tests) */
export function resetRouterConfig(): void {
  cachedConfig = null;
}

// ---------------------------------------------------------------------------
// Scoring Engine
// ---------------------------------------------------------------------------

/**
 * Score a task from multiple signals. The resulting number is mapped to a tier:
 *   score ≤ liteMax       → LITE
 *   score ≥ premiumMin    → PREMIUM
 *   otherwise             → STANDARD
 */
function scoreTask(
  botName: string,
  command: string,
  promptLength: number,
  flags: Record<string, string | boolean>,
): { score: number; components: string[] } {
  let score = 0;
  const components: string[] = [];

  // 1. Bot baseline bias
  const botBias = BOT_TIER_BIAS[botName] ?? 0;
  if (botBias !== 0) {
    score += botBias;
    components.push(`bot(${botName}):${botBias > 0 ? '+' : ''}${botBias}`);
  }

  // 2. Command weight
  const cmdWeight = COMMAND_TIER_WEIGHT[command] ?? 0;
  if (cmdWeight !== 0) {
    score += cmdWeight;
    components.push(`cmd(${command}):${cmdWeight > 0 ? '+' : ''}${cmdWeight}`);
  }

  // 3. Prompt length complexity
  let lengthBias = 0;
  if (promptLength <= PROMPT_LENGTH_THRESHOLDS.short) {
    lengthBias = -1;
  } else if (promptLength >= PROMPT_LENGTH_THRESHOLDS.veryLong) {
    lengthBias = 2;
  } else if (promptLength >= PROMPT_LENGTH_THRESHOLDS.long) {
    lengthBias = 1;
  }
  if (lengthBias !== 0) {
    score += lengthBias;
    components.push(`len(${promptLength}):${lengthBias > 0 ? '+' : ''}${lengthBias}`);
  }

  // 4. Decomposition flag — if the task is being decomposed, it's complex
  if (flags['decompose'] === true) {
    score += 1;
    components.push('flag(decompose):+1');
  }

  return { score, components };
}

/** Map a numeric score to a ModelTier */
function scoreToTier(score: number): ModelTier {
  if (score <= TIER_SCORE_BOUNDARIES.liteMax) return ModelTier.LITE;
  if (score >= TIER_SCORE_BOUNDARIES.premiumMin) return ModelTier.PREMIUM;
  return ModelTier.STANDARD;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Route a parsed command to the optimal model.
 *
 * @param command       The parsed command (botName, command, args, flags)
 * @param projectModel  The project's configured defaultModel (used as fallback
 *                      when routing is disabled or as the standard tier model)
 * @returns A routing decision with the selected model and reasoning
 */
export function routeToModel(
  command: ParsedCommand,
  projectModel: string,
): RoutingDecision {
  const config = loadConfig();

  // Explicit --model flag always wins — no routing needed
  const explicitModel = command.flags['model'];
  if (typeof explicitModel === 'string' && explicitModel.length > 0) {
    const decision: RoutingDecision = {
      tier: ModelTier.STANDARD,
      model: explicitModel,
      score: 0,
      reason: `Explicit --model flag: ${explicitModel}`,
      overridden: true,
    };
    logger.debug(decision, 'Model routing overridden by --model flag');
    return decision;
  }

  // If routing is disabled, fall back to the project default
  if (!config.enabled) {
    const decision: RoutingDecision = {
      tier: ModelTier.STANDARD,
      model: projectModel,
      score: 0,
      reason: 'Model routing disabled — using project default',
      overridden: false,
    };
    logger.debug(decision, 'Model routing disabled');
    return decision;
  }

  // Score the task
  const { score, components } = scoreTask(
    command.botName,
    command.command,
    command.args.length,
    command.flags,
  );

  const tier = scoreToTier(score);
  const model = config.tierModels[tier];
  const reason = `score=${score} [${components.join(', ')}] → ${tier}`;

  const decision: RoutingDecision = {
    tier,
    model,
    score,
    reason,
    overridden: false,
  };

  logger.info(
    { botName: command.botName, command: command.command, promptLen: command.args.length, ...decision },
    'Model routed',
  );

  return decision;
}
