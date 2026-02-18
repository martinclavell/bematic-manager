export const Limits = {
  /** Max concurrent Claude sessions per agent */
  MAX_CONCURRENT_TASKS: 5,

  /** Rate limit: requests per window */
  RATE_LIMIT_MAX_REQUESTS: 50,

  /** Rate limit window in ms (1 hour) */
  RATE_LIMIT_WINDOW_MS: 3_600_000,

  /** WebSocket heartbeat interval in ms */
  WS_HEARTBEAT_INTERVAL_MS: 30_000,

  /** WebSocket auth timeout in ms */
  WS_AUTH_TIMEOUT_MS: 10_000,

  /** Offline queue message TTL in ms (24 hours) */
  OFFLINE_QUEUE_TTL_MS: 86_400_000,

  /** Slack message update interval for streaming in ms */
  SLACK_STREAM_UPDATE_INTERVAL_MS: 3_000,

  /** Max prompt length in characters */
  MAX_PROMPT_LENGTH: 10_000,

  /** WebSocket reconnect base delay in ms */
  WS_RECONNECT_BASE_DELAY_MS: 1_000,

  /** WebSocket reconnect max delay in ms */
  WS_RECONNECT_MAX_DELAY_MS: 30_000,

  /** Max auto-continuations when Claude hits max_turns limit */
  MAX_CONTINUATIONS: 3,

  /** Max turns per Claude invocation */
  MAX_TURNS_PER_INVOCATION: 200,

  /** Slack message limits (based on Slack API constraints) */
  SLACK_MESSAGE_MAX_LENGTH: 40_000, // Slack hard limit
  SLACK_MESSAGE_RECOMMENDED_LENGTH: 15_000, // Safe limit to avoid truncation issues
  SLACK_SECTION_BLOCK_MAX_LENGTH: 3_000, // Per section block limit
  SLACK_STREAMING_DISPLAY_LENGTH: 12_000, // Display limit for streaming messages
  SLACK_FINAL_DISPLAY_LENGTH: 15_000, // Display limit for final results

  /** Agent keepalive ping interval in ms (send ping to cloud every 20s) */
  AGENT_KEEPALIVE_INTERVAL_MS: 20_000,

  /** Anthropic API call timeout in ms (5 minutes) */
  CLAUDE_API_TIMEOUT_MS: 300_000,

  /** Circuit breaker: max consecutive reconnection failures before backing off */
  CIRCUIT_BREAKER_MAX_FAILURES: 10,

  /** Circuit breaker: long backoff interval when circuit is open (5 minutes) */
  CIRCUIT_BREAKER_LONG_BACKOFF_MS: 300_000,
} as const;
