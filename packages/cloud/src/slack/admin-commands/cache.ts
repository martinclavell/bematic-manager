import type { App } from '@slack/bolt';
import type { AppContext } from '../../context.js';
import { Permission, createLogger, CacheInvalidators, globalCache, projectCache, agentCache, userCache } from '@bematic/common';

const logger = createLogger('admin:cache');

export function registerCacheCommands(app: App, ctx: AppContext) {
  // Cache stats command
  app.command('/cache-stats', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_VIEW);

      const globalStats = globalCache.getStats();
      const projectStats = projectCache.getStats();
      const agentStats = agentCache.getStats();
      const userStats = userCache.getStats();

      const formatStats = (name: string, stats: any) => {
        return `*${name}*:\n` +
               `• Entries: ${stats.entries}\n` +
               `• Hits: ${stats.hits}\n` +
               `• Misses: ${stats.misses}\n` +
               `• Hit Rate: ${(stats.hitRate * 100).toFixed(2)}%\n` +
               `• Memory: ${(stats.memoryUsage / 1024).toFixed(2)} KB`;
      };

      await respond({
        text: `:chart_with_upwards_trend: **Cache Statistics**\n\n` +
               `${formatStats('Global Cache', globalStats)}\n\n` +
               `${formatStats('Project Cache', projectStats)}\n\n` +
               `${formatStats('Agent Cache', agentStats)}\n\n` +
               `${formatStats('User Cache', userStats)}`,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Cache stats command failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to get cache stats'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Clear all caches command
  app.command('/cache-clear', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_MANAGE);

      const beforeStats = {
        global: globalCache.size(),
        project: projectCache.size(),
        agent: agentCache.size(),
        user: userCache.size(),
      };

      CacheInvalidators.clearAll();

      logger.info({ beforeStats, userId: command.user_id }, 'Cleared all caches');

      await respond({
        text: `:boom: **All Caches Cleared**\n\n` +
               `• Global: ${beforeStats.global} entries\n` +
               `• Project: ${beforeStats.project} entries\n` +
               `• Agent: ${beforeStats.agent} entries\n` +
               `• User: ${beforeStats.user} entries\n\n` +
               `*All caches have been emptied.*`,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Cache clear command failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to clear caches'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Invalidate specific project cache
  app.command('/cache-invalidate-project', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_MANAGE);

      const projectId = command.text?.trim();
      if (!projectId) {
        await respond({
          text: `:warning: Please provide a project ID. Usage: \`/cache-invalidate-project <project-id>\``,
          response_type: 'ephemeral',
        });
        return;
      }

      const project = ctx.projectRepo.findById(projectId);
      if (!project) {
        await respond({
          text: `:x: Project '${projectId}' not found.`,
          response_type: 'ephemeral',
        });
        return;
      }

      CacheInvalidators.invalidateProject(projectId);

      logger.info({ projectId, userId: command.user_id }, 'Invalidated project cache');

      await respond({
        text: `:white_check_mark: Invalidated cache for project \`${projectId}\` (${project.name})`,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Project cache invalidation failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to invalidate project cache'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Invalidate specific agent cache
  app.command('/cache-invalidate-agent', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_MANAGE);

      const agentId = command.text?.trim();
      if (!agentId) {
        await respond({
          text: `:warning: Please provide an agent ID. Usage: \`/cache-invalidate-agent <agent-id>\``,
          response_type: 'ephemeral',
        });
        return;
      }

      CacheInvalidators.invalidateAgent(agentId);

      logger.info({ agentId, userId: command.user_id }, 'Invalidated agent cache');

      await respond({
        text: `:white_check_mark: Invalidated cache for agent \`${agentId}\``,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Agent cache invalidation failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to invalidate agent cache'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Invalidate specific user cache
  app.command('/cache-invalidate-user', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_MANAGE);

      const userId = command.text?.trim();
      if (!userId) {
        await respond({
          text: `:warning: Please provide a user ID. Usage: \`/cache-invalidate-user <user-id>\``,
          response_type: 'ephemeral',
        });
        return;
      }

      CacheInvalidators.invalidateSlackUser(userId);

      logger.info({ targetUserId: userId, adminUserId: command.user_id }, 'Invalidated user cache');

      await respond({
        text: `:white_check_mark: Invalidated cache for user \`<@${userId}>\``,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'User cache invalidation failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to invalidate user cache'}`,
        response_type: 'ephemeral',
      });
    }
  });

  // Cache warming command
  app.command('/cache-warm', async ({ ack, respond, command }) => {
    await ack();

    try {
      await ctx.authChecker.checkPermission(command.user_id, Permission.ADMIN_MANAGE);

      const startTime = Date.now();
      let warmedCount = 0;

      const allProjects = ctx.projectRepo.findAll();
      warmedCount += allProjects.length;

      const connectedAgents = ctx.agentManager.getConnectedAgentIds();
      for (const agentId of connectedAgents) {
        const agent = ctx.agentManager.getAgent(agentId);
        if (agent) {
          warmedCount++;
        }
      }

      const duration = Date.now() - startTime;

      logger.info({
        warmedCount,
        duration,
        projects: allProjects.length,
        agents: connectedAgents.length,
        userId: command.user_id,
      }, 'Cache warming completed');

      await respond({
        text: `:fire: **Cache Warming Complete**\n\n` +
               `• Warmed ${warmedCount} entries\n` +
               `• Projects: ${allProjects.length}\n` +
               `• Agents: ${connectedAgents.length}\n` +
               `• Duration: ${duration}ms`,
        response_type: 'ephemeral',
      });

    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Cache warming failed');
      await respond({
        text: `:x: ${error instanceof Error ? error.message : 'Failed to warm caches'}`,
        response_type: 'ephemeral',
      });
    }
  });
}
