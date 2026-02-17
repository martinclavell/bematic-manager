// ---------------------------------------------------------------------------
// Model Routing Strategy
// ---------------------------------------------------------------------------
// Simple, quality-focused approach:
//   - Sonnet 4.5: Default for all tasks (read-only, analysis, simple writes)
//   - Opus 4: Only for code implementation (CoderBot write operations)
//
// No Haiku — it produces lower quality results.
// ---------------------------------------------------------------------------

/** Supported model tier identifiers */
export const ModelTier = {
  /** Sonnet 4.5 - Default for all read-only and analysis tasks */
  STANDARD: 'standard',
  /** Opus 4 - Only for actual code implementation */
  PREMIUM: 'premium',
} as const;

export type ModelTier = (typeof ModelTier)[keyof typeof ModelTier];

/** Default Claude model ID for each tier (overridable via env vars) */
export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  [ModelTier.STANDARD]: 'claude-sonnet-4-5-20250929',
  [ModelTier.PREMIUM]: 'claude-opus-4-20250514',
};

/** Approximate cost per 1 M tokens (USD) — used for budget estimation only */
export const TIER_COST_PER_MILLION: Record<ModelTier, { input: number; output: number }> = {
  [ModelTier.STANDARD]: { input: 3.00, output: 15.00 },
  [ModelTier.PREMIUM]: { input: 15.00, output: 75.00 },
};

// ---------------------------------------------------------------------------
// Routing Rules — Simple: Write = Opus, Everything Else = Sonnet
// ---------------------------------------------------------------------------

/**
 * Commands that perform actual code implementation → use Opus.
 * Everything else (read-only, analysis, planning) → use Sonnet.
 */
export const OPUS_COMMANDS = new Set([
  // CoderBot write commands
  'fix',
  'bugfix',
  'debug',
  'feature',
  'add',
  'implement',
  'create',
  'refactor',
  'cleanup',
  'improve',
  'test',
  'tests',
]);

/**
 * Bots that perform write operations.
 * CoderBot → can use Opus for implementation.
 * All others (Reviewer, Ops, Planner) → always Sonnet (read-only).
 */
export const WRITE_BOTS = new Set(['coder']);
