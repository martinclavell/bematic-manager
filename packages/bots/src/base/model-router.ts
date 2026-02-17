import {
  ModelTier,
  DEFAULT_TIER_MODELS,
  OPUS_COMMANDS,
  WRITE_BOTS,
  createLogger,
  type ParsedCommand,
} from '@bematic/common';

const logger = createLogger('model-router');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Breakdown of how the router selected a model */
export interface RoutingDecision {
  /** The tier that was selected */
  tier: ModelTier;
  /** The concrete model ID to use */
  model: string;
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
// Routing Logic — Simple: Write Operations = Opus, Everything Else = Sonnet
// ---------------------------------------------------------------------------

/**
 * Route a parsed command to the optimal model.
 *
 * Strategy:
 * - Sonnet 4.5: Default for all tasks (read-only, analysis, planning)
 * - Opus 4: Only for CoderBot write commands (fix, feature, refactor, test)
 *
 * @param command       The parsed command (botName, command, args, flags)
 * @param projectModel  The project's configured defaultModel (used as fallback
 *                      when routing is disabled)
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
      reason: 'Model routing disabled — using project default',
      overridden: false,
    };
    logger.debug(decision, 'Model routing disabled');
    return decision;
  }

  // Determine tier: Opus for CoderBot write commands, Sonnet for everything else
  const isWriteBot = WRITE_BOTS.has(command.botName);
  const isWriteCommand = OPUS_COMMANDS.has(command.command);
  const useOpus = isWriteBot && isWriteCommand;

  const tier = useOpus ? ModelTier.PREMIUM : ModelTier.STANDARD;
  const model = config.tierModels[tier];
  const reason = useOpus
    ? `CoderBot write command (${command.command}) → Opus for implementation`
    : `${command.botName}/${command.command} → Sonnet (read-only or analysis)`;

  const decision: RoutingDecision = {
    tier,
    model,
    reason,
    overridden: false,
  };

  logger.info(
    { botName: command.botName, command: command.command, tier, model },
    'Model routed',
  );

  return decision;
}
