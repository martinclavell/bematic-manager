import { Limits } from '@bematic/common';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function loadAgentConfig() {
  return {
    cloudWsUrl: requireEnv('CLOUD_WS_URL'),
    agentId: requireEnv('AGENT_ID'),
    agentApiKey: requireEnv('AGENT_API_KEY'),
    anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY', ''),
    maxConcurrentTasks: parseInt(
      optionalEnv('MAX_CONCURRENT_TASKS', String(Limits.MAX_CONCURRENT_TASKS)),
      10,
    ),
    maxContinuations: parseInt(
      optionalEnv('MAX_CONTINUATIONS', String(Limits.MAX_CONTINUATIONS)),
      10,
    ),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
    reconnect: {
      baseDelayMs: parseInt(
        optionalEnv('WS_RECONNECT_BASE_DELAY_MS', String(Limits.WS_RECONNECT_BASE_DELAY_MS)),
        10,
      ),
      maxDelayMs: parseInt(
        optionalEnv('WS_RECONNECT_MAX_DELAY_MS', String(Limits.WS_RECONNECT_MAX_DELAY_MS)),
        10,
      ),
    },
    resourceLimits: {
      maxMemoryMB: parseInt(optionalEnv('AGENT_MAX_MEMORY_MB', '2048'), 10),
      maxCpuPercent: parseInt(optionalEnv('AGENT_MAX_CPU_PERCENT', '80'), 10),
      taskTimeoutMs: parseInt(optionalEnv('AGENT_TASK_TIMEOUT_MS', '1800000'), 10), // 30 minutes
      healthCheckIntervalMs: parseInt(optionalEnv('AGENT_HEALTH_CHECK_INTERVAL_MS', '30000'), 10), // 30 seconds
    },
    tempFiles: {
      maxAgeHours: parseInt(optionalEnv('TEMP_FILE_MAX_AGE_HOURS', '24'), 10),
      maxTotalSizeMB: parseInt(optionalEnv('TEMP_FILE_MAX_SIZE_MB', '1000'), 10),
      cleanupIntervalMs: parseInt(optionalEnv('TEMP_FILE_CLEANUP_INTERVAL_MS', '600000'), 10), // 10 minutes
      tempDir: optionalEnv('TEMP_FILE_DIR', './temp'),
    },
  };
}

export type AgentConfig = ReturnType<typeof loadAgentConfig>;
