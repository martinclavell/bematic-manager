import { MemoryCache } from './memory-cache.js';

export { CacheManager, type CacheEntry, type CacheStats, type CacheOptions } from './cache-manager.js';
export { MemoryCache } from './memory-cache.js';

// Create singleton instances for commonly used caches
export const globalCache = new MemoryCache({
  defaultTtl: 5 * 60 * 1000, // 5 minutes
  maxSize: 10000,
  enableStats: true,
  cleanupInterval: 60 * 1000, // 1 minute
});

export const projectCache = new MemoryCache({
  defaultTtl: 5 * 60 * 1000, // 5 minutes for project data
  maxSize: 1000,
  enableStats: true,
  cleanupInterval: 60 * 1000,
});

export const agentCache = new MemoryCache({
  defaultTtl: 30 * 1000, // 30 seconds for agent status
  maxSize: 500,
  enableStats: true,
  cleanupInterval: 15 * 1000, // 15 seconds
});

export const userCache = new MemoryCache({
  defaultTtl: 10 * 60 * 1000, // 10 minutes for Slack user info
  maxSize: 2000,
  enableStats: true,
  cleanupInterval: 2 * 60 * 1000, // 2 minutes
});

// Cache key generators
export const CacheKeys = {
  project: (id: string) => `project:${id}`,
  projectByChannel: (channelId: string) => `project:channel:${channelId}`,
  projectByAgent: (agentId: string) => `project:agent:${agentId}`,
  agentStatus: (agentId: string) => `agent:status:${agentId}`,
  agentMetadata: (agentId: string) => `agent:metadata:${agentId}`,
  slackUser: (userId: string) => `slack:user:${userId}`,
  botConfig: (botId: string) => `bot:config:${botId}`,
  rateLimitCheck: (userId: string) => `ratelimit:${userId}`,

  // Pattern matchers
  projectPattern: (pattern: string) => `project:${pattern}`,
  agentPattern: (pattern: string) => `agent:${pattern}`,
  slackPattern: (pattern: string) => `slack:${pattern}`,
} as const;

// Cache invalidation helpers
export const CacheInvalidators = {
  /**
   * Invalidate all project-related cache entries
   */
  invalidateProject: (projectId: string) => {
    projectCache.delete(CacheKeys.project(projectId));
    // Also invalidate any related entries
    const projectKeys = projectCache.getKeysMatching(`project:*:${projectId}*`);
    projectCache.deleteMany(projectKeys);
  },

  /**
   * Invalidate agent-related cache entries
   */
  invalidateAgent: (agentId: string) => {
    agentCache.delete(CacheKeys.agentStatus(agentId));
    agentCache.delete(CacheKeys.agentMetadata(agentId));
    // Also invalidate projects by agent
    projectCache.deleteMatching(CacheKeys.projectByAgent(agentId));
  },

  /**
   * Invalidate Slack user cache
   */
  invalidateSlackUser: (userId: string) => {
    userCache.delete(CacheKeys.slackUser(userId));
  },

  /**
   * Clear all caches
   */
  clearAll: () => {
    globalCache.clear();
    projectCache.clear();
    agentCache.clear();
    userCache.clear();
  },
} as const;