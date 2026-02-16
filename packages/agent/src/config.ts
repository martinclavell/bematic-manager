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
  };
}

export type AgentConfig = ReturnType<typeof loadAgentConfig>;
