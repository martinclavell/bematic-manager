import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('admin:users');

const VALID_ROLES = ['viewer', 'developer', 'admin'] as const;
type ValidRole = typeof VALID_ROLES[number];

function isValidRole(role: string): role is ValidRole {
  return VALID_ROLES.includes(role as ValidRole);
}

export class UserCommands {
  constructor(private readonly ctx: AppContext) {}

  async handleUsersCommand(args: string[]): Promise<string> {
    if (args.length === 0) {
      return this.getUsersHelp();
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    switch (command) {
      case 'list':
        return this.listUsers(commandArgs);
      case 'role':
        return this.changeUserRole(commandArgs);
      case 'deactivate':
        return this.deactivateUser(commandArgs);
      case 'reactivate':
        return this.reactivateUser(commandArgs);
      case 'rate-limit':
        return this.updateRateLimit(commandArgs);
      case 'info':
        return this.getUserInfo(commandArgs);
      default:
        return this.getUsersHelp();
    }
  }

  private getUsersHelp(): string {
    return `*User Management Commands:*
\`/bm-admin users list [role]\` - List all users or users with specific role
\`/bm-admin users role <user-id> <role>\` - Change user role (viewer, developer, admin)
\`/bm-admin users deactivate <user-id>\` - Deactivate a user
\`/bm-admin users reactivate <user-id>\` - Reactivate a user
\`/bm-admin users rate-limit <user-id> <limit|none>\` - Set rate limit override
\`/bm-admin users info <user-id>\` - Get detailed user information

**Valid roles:** ${VALID_ROLES.join(', ')}`;
  }

  private listUsers(args: string[]): string {
    const roleFilter = args.length > 0 ? args[0] : null;

    if (roleFilter && !isValidRole(roleFilter)) {
      return `:x: Invalid role "${roleFilter}". Valid roles: ${VALID_ROLES.join(', ')}`;
    }

    const users = roleFilter ?
      this.ctx.userRepo.findByRole(roleFilter) :
      this.ctx.userRepo.findAll();

    if (users.length === 0) {
      const filterText = roleFilter ? ` with role "${roleFilter}"` : '';
      return `:information_source: No users found${filterText}`;
    }

    const header = roleFilter ?
      `*Users with role "${roleFilter}" (${users.length}):*\n` :
      `*All Users (${users.length}):*\n`;

    const lines = users.map(user => {
      const statusEmoji = user.active ? ':green_circle:' : ':red_circle:';
      const rateLimitText = user.rateLimitOverride ? ` (limit: ${user.rateLimitOverride})` : '';
      const createdDate = new Date(user.createdAt).toLocaleDateString();

      return `${statusEmoji} \`${user.id.slice(0, 8)}\` - @${user.slackUsername} - ${user.role}${rateLimitText} - ${createdDate}`;
    });

    return header + lines.join('\n');
  }

  private async changeUserRole(args: string[]): Promise<string> {
    if (args.length < 2) {
      return ':x: Please provide user ID and role: `/bm-admin users role <user-id> <role>`';
    }

    const userId = args[0];
    const newRole = args[1];

    if (!isValidRole(newRole)) {
      return `:x: Invalid role "${newRole}". Valid roles: ${VALID_ROLES.join(', ')}`;
    }

    try {
      const user = this.ctx.userRepo.changeRole(userId, newRole);
      if (!user) {
        return `:warning: User \`${userId}\` not found`;
      }

      logger.info({ userId, oldRole: user.role, newRole }, 'User role changed by admin');
      return `:white_check_mark: Changed role for @${user.slackUsername} (\`${userId.slice(0, 8)}\`) to **${newRole}**`;

    } catch (error) {
      logger.error({ error, userId, newRole }, 'Failed to change user role');
      return `:x: Failed to change role: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async deactivateUser(args: string[]): Promise<string> {
    if (args.length === 0) {
      return ':x: Please provide a user ID: `/bm-admin users deactivate <user-id>`';
    }

    const userId = args[0];

    try {
      const user = this.ctx.userRepo.deactivateUser(userId);
      if (!user) {
        return `:warning: User \`${userId}\` not found`;
      }

      logger.info({ userId, username: user.slackUsername }, 'User deactivated by admin');
      return `:white_check_mark: Deactivated user @${user.slackUsername} (\`${userId.slice(0, 8)}\`)`;

    } catch (error) {
      logger.error({ error, userId }, 'Failed to deactivate user');
      return `:x: Failed to deactivate user: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async reactivateUser(args: string[]): Promise<string> {
    if (args.length === 0) {
      return ':x: Please provide a user ID: `/bm-admin users reactivate <user-id>`';
    }

    const userId = args[0];

    try {
      const user = this.ctx.userRepo.reactivateUser(userId);
      if (!user) {
        return `:warning: User \`${userId}\` not found`;
      }

      logger.info({ userId, username: user.slackUsername }, 'User reactivated by admin');
      return `:white_check_mark: Reactivated user @${user.slackUsername} (\`${userId.slice(0, 8)}\`)`;

    } catch (error) {
      logger.error({ error, userId }, 'Failed to reactivate user');
      return `:x: Failed to reactivate user: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async updateRateLimit(args: string[]): Promise<string> {
    if (args.length < 2) {
      return ':x: Please provide user ID and limit: `/bm-admin users rate-limit <user-id> <limit|none>`';
    }

    const userId = args[0];
    const limitArg = args[1];

    let rateLimitOverride: number | null = null;

    if (limitArg.toLowerCase() !== 'none') {
      const limit = parseInt(limitArg);
      if (isNaN(limit) || limit < 1) {
        return ':x: Rate limit must be a positive number or "none"';
      }
      rateLimitOverride = limit;
    }

    try {
      const user = this.ctx.userRepo.updateRateLimitOverride(userId, rateLimitOverride);
      if (!user) {
        return `:warning: User \`${userId}\` not found`;
      }

      const limitText = rateLimitOverride ? `${rateLimitOverride} requests` : 'default limit';
      logger.info({ userId, username: user.slackUsername, rateLimitOverride }, 'User rate limit updated by admin');
      return `:white_check_mark: Updated rate limit for @${user.slackUsername} (\`${userId.slice(0, 8)}\`) to ${limitText}`;

    } catch (error) {
      logger.error({ error, userId, rateLimitOverride }, 'Failed to update rate limit');
      return `:x: Failed to update rate limit: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private getUserInfo(args: string[]): string {
    if (args.length === 0) {
      return ':x: Please provide a user ID: `/bm-admin users info <user-id>`';
    }

    const userId = args[0];

    try {
      const user = this.ctx.userRepo.findById(userId);
      if (!user) {
        return `:warning: User \`${userId}\` not found`;
      }

      const statusEmoji = user.active ? ':green_circle:' : ':red_circle:';
      const createdDate = new Date(user.createdAt).toLocaleString();
      const updatedDate = new Date(user.updatedAt).toLocaleString();
      const rateLimitText = user.rateLimitOverride ? `${user.rateLimitOverride} requests` : 'Default';

      // Try to get recent task count if task repo is available
      let recentTasksText = '';
      try {
        // Note: This assumes taskRepo has a method to find by user - may need adjustment
        recentTasksText = '\n:information_source: _Task history not available in this context_';
      } catch {
        recentTasksText = '\n:information_source: _Task history not available_';
      }

      return `*User Information:*

${statusEmoji} **Status:** ${user.active ? 'Active' : 'Inactive'}
:bust_in_silhouette: **Username:** @${user.slackUsername}
:id: **User ID:** \`${user.id}\`
:key: **Slack User ID:** \`${user.slackUserId}\`
:shield: **Role:** ${user.role}
:hourglass: **Rate Limit:** ${rateLimitText}
:calendar: **Created:** ${createdDate}
:pencil2: **Updated:** ${updatedDate}${recentTasksText}`;

    } catch (error) {
      logger.error({ error, userId }, 'Failed to get user info');
      return `:x: Failed to get user info: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}