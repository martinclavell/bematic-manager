import type { UserRole } from '../constants/permissions.js';

export interface User {
  id: string;
  slackUserId: string;
  slackUsername: string;
  role: UserRole;
  rateLimitOverride: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRequestPayload {
  agentId: string;
  apiKey: string;
  version: string;
}

export interface AuthResponsePayload {
  success: boolean;
  error?: string;
  agentId?: string;
}
