import {
  AuthorizationError,
  ROLE_PERMISSIONS,
  type Permission,
  type UserRole,
  createLogger,
} from '@bematic/common';
import type { UserRepository } from '@bematic/db';

const logger = createLogger('auth');

export function createAuthChecker(userRepo: UserRepository) {
  return {
    async checkPermission(slackUserId: string, permission: Permission): Promise<void> {
      const user = userRepo.findBySlackUserId(slackUserId);

      if (!user) {
        // Auto-create as developer on first interaction
        logger.info({ slackUserId }, 'Unknown user, will be auto-provisioned');
        return; // Allow by default for new users
      }

      if (!user.active) {
        throw new AuthorizationError('User account is deactivated');
      }

      const rolePermissions = ROLE_PERMISSIONS[user.role as UserRole];
      if (!rolePermissions?.includes(permission)) {
        throw new AuthorizationError(
          `Role "${user.role}" lacks permission "${permission}"`,
        );
      }
    },

    getUserRole(slackUserId: string): UserRole | null {
      const user = userRepo.findBySlackUserId(slackUserId);
      return user ? (user.role as UserRole) : null;
    },
  };
}
