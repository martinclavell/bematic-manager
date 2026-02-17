// ---------------------------------------------------------------------------
// Model Tiers & Routing Configuration
// ---------------------------------------------------------------------------
// Each tier maps to a Claude model variant optimised for a class of tasks.
// The router in @bematic/bots scores every incoming task and picks a tier.
// ---------------------------------------------------------------------------

/** Supported model tier identifiers */
export const ModelTier = {
  LITE: 'lite',
  STANDARD: 'standard',
  PREMIUM: 'premium',
} as const;

export type ModelTier = (typeof ModelTier)[keyof typeof ModelTier];

/** Default Claude model ID for each tier (overridable via env vars) */
export const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  [ModelTier.LITE]: 'claude-haiku-3-5-20241022',
  [ModelTier.STANDARD]: 'claude-sonnet-4-5-20250929',
  [ModelTier.PREMIUM]: 'claude-opus-4-20250514',
};

/** Approximate cost per 1 M tokens (USD) — used for budget estimation only */
export const TIER_COST_PER_MILLION: Record<ModelTier, { input: number; output: number }> = {
  [ModelTier.LITE]: { input: 0.80, output: 4.00 },
  [ModelTier.STANDARD]: { input: 3.00, output: 15.00 },
  [ModelTier.PREMIUM]: { input: 15.00, output: 75.00 },
};

// ---------------------------------------------------------------------------
// Scoring weights — the router sums these signals to pick a tier
// ---------------------------------------------------------------------------

/**
 * Per-bot baseline tier bias.
 * Values: -1 = lean lite, 0 = neutral, +1 = lean premium.
 */
export const BOT_TIER_BIAS: Record<string, number> = {
  planner: -1,
  ops: -0.5,
  reviewer: 0,
  coder: 0.5,
};

/**
 * Per-command tier weight.
 * Positive → pushes toward premium.  Negative → pushes toward lite.
 */
export const COMMAND_TIER_WEIGHT: Record<string, number> = {
  // Lite-leaning commands
  status: -2,
  logs: -2,
  log: -2,
  list: -1.5,
  ls: -1.5,
  show: -1.5,
  info: -1.5,
  explain: -1,
  report: -1,
  summary: -1,
  diff: -0.5,

  // Neutral
  review: 0,
  check: 0,
  build: 0,
  git: 0,
  sprint: 0,
  plan: 0,

  // Standard-leaning commands
  fix: 0.5,
  bugfix: 0.5,
  debug: 0.5,
  test: 0.5,
  tests: 0.5,
  deploy: 0.5,

  // Premium-leaning commands
  feature: 1.5,
  add: 1.5,
  implement: 1.5,
  create: 1,
  refactor: 1.5,
  cleanup: 1,
  improve: 1,
  security: 1.5,
  sec: 1.5,
  vuln: 1.5,
};

/**
 * Prompt-length thresholds for complexity scoring.
 * Short prompts get a negative bias, long ones get positive.
 */
export const PROMPT_LENGTH_THRESHOLDS = {
  /** Below this → lite bias (-1) */
  short: 50,
  /** Above this → premium bias (+1) */
  long: 200,
  /** Above this → strong premium bias (+2) */
  veryLong: 500,
} as const;

/** Score boundaries for tier selection */
export const TIER_SCORE_BOUNDARIES = {
  /** Score ≤ this → lite */
  liteMax: -1,
  /** Score ≥ this → premium */
  premiumMin: 2,
  /** Everything in between → standard */
} as const;
