export const UserRole = {
  ADMIN: 'admin',
  DEVELOPER: 'developer',
  VIEWER: 'viewer',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const Permission = {
  TASK_CREATE: 'task:create',
  TASK_CANCEL: 'task:cancel',
  TASK_VIEW: 'task:view',
  PROJECT_MANAGE: 'project:manage',
  PROJECT_VIEW: 'project:view',
  BOT_CONFIG: 'bot:config',
  USER_MANAGE: 'user:manage',
  AUDIT_VIEW: 'audit:view',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.ADMIN]: Object.values(Permission),
  [UserRole.DEVELOPER]: [
    Permission.TASK_CREATE,
    Permission.TASK_CANCEL,
    Permission.TASK_VIEW,
    Permission.PROJECT_VIEW,
  ],
  [UserRole.VIEWER]: [
    Permission.TASK_VIEW,
    Permission.PROJECT_VIEW,
  ],
};
