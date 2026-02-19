import type { WebClient } from '@slack/web-api';
import { createLogger, userCache, CacheKeys } from '@bematic/common';

const logger = createLogger('slack-user-service');

export interface SlackUserInfo {
  id: string;
  name: string;
  real_name?: string;
  display_name?: string;
  email?: string;
  is_bot?: boolean;
  is_admin?: boolean;
  is_owner?: boolean;
  team_id?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    email?: string;
    image_24?: string;
    image_32?: string;
    image_48?: string;
    image_72?: string;
    image_192?: string;
  };
  cached_at?: number;
}

export class SlackUserService {
  constructor(private readonly slackClient: WebClient) {}

  async getUserInfo(userId: string): Promise<SlackUserInfo | null> {
    const cacheKey = CacheKeys.slackUser(userId);
    const cached = userCache.get<SlackUserInfo>(cacheKey);

    if (cached !== null) {
      logger.debug({ userId }, 'Slack user info retrieved from cache');
      return cached;
    }

    try {
      logger.debug({ userId }, 'Fetching Slack user info from API');
      const response = await this.slackClient.users.info({
        user: userId,
      });

      if (!response.ok || !response.user) {
        logger.warn({ userId, error: response.error }, 'Failed to fetch user info');
        return null;
      }

      const userInfo: SlackUserInfo = {
        id: response.user.id!,
        name: response.user.name!,
        real_name: response.user.real_name,
        display_name: response.user.profile?.display_name,
        email: response.user.profile?.email,
        is_bot: response.user.is_bot,
        is_admin: response.user.is_admin,
        is_owner: response.user.is_owner,
        team_id: response.user.team_id,
        profile: response.user.profile ? {
          display_name: response.user.profile.display_name,
          real_name: response.user.profile.real_name,
          email: response.user.profile.email,
          image_24: response.user.profile.image_24,
          image_32: response.user.profile.image_32,
          image_48: response.user.profile.image_48,
          image_72: response.user.profile.image_72,
          image_192: response.user.profile.image_192,
        } : undefined,
        cached_at: Date.now(),
      };

      userCache.set(cacheKey, userInfo, 10 * 60 * 1000);
      logger.debug({ userId }, 'Cached Slack user info');

      return userInfo;
    } catch (error) {
      logger.error({ error, userId }, 'Error fetching Slack user info');
      return null;
    }
  }

  async getUserInfos(userIds: string[]): Promise<Map<string, SlackUserInfo | null>> {
    const result = new Map<string, SlackUserInfo | null>();
    const uncachedIds: string[] = [];

    for (const userId of userIds) {
      const cached = userCache.get<SlackUserInfo>(CacheKeys.slackUser(userId));
      if (cached !== null) {
        result.set(userId, cached);
      } else {
        uncachedIds.push(userId);
      }
    }

    if (uncachedIds.length > 0) {
      logger.debug({ count: uncachedIds.length }, 'Fetching uncached user infos');

      const promises = uncachedIds.map(userId => this.getUserInfo(userId));
      const results = await Promise.all(promises);

      for (let i = 0; i < uncachedIds.length; i++) {
        result.set(uncachedIds[i]!, results[i]);
      }
    }

    return result;
  }

  invalidateUserCache(userId: string): void {
    const cacheKey = CacheKeys.slackUser(userId);
    userCache.delete(cacheKey);
    logger.debug({ userId }, 'Invalidated Slack user cache');
  }

  async preloadUserInfo(userId: string): Promise<void> {
    const cached = userCache.get<SlackUserInfo>(CacheKeys.slackUser(userId));
    if (cached === null) {
      await this.getUserInfo(userId);
    }
  }

  getCacheStats() {
    return userCache.getStats();
  }

  async getUserDisplayName(userId: string): Promise<string> {
    const userInfo = await this.getUserInfo(userId);
    if (!userInfo) {
      return `<@${userId}>`;
    }

    return userInfo.profile?.display_name ||
           userInfo.display_name ||
           userInfo.real_name ||
           userInfo.name ||
           `<@${userId}>`;
  }

  async isUserAdmin(userId: string): Promise<boolean> {
    const userInfo = await this.getUserInfo(userId);
    return !!(userInfo?.is_admin || userInfo?.is_owner);
  }

  async isUserBot(userId: string): Promise<boolean> {
    const userInfo = await this.getUserInfo(userId);
    return !!userInfo?.is_bot;
  }

  async getUserEmail(userId: string): Promise<string | null> {
    const userInfo = await this.getUserInfo(userId);
    return userInfo?.email || userInfo?.profile?.email || null;
  }
}
