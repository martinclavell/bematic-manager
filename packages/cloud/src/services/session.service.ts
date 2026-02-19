import { createLogger } from '@bematic/common';
import type { SessionRepository } from '@bematic/db';

const logger = createLogger('session-service');

export class SessionService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly cleanupIntervalMs: number;

  constructor(
    private readonly sessionRepo: SessionRepository,
    options: {
      cleanupIntervalMs?: number;
    } = {}
  ) {
    this.cleanupIntervalMs = options.cleanupIntervalMs || 3600000; // 1 hour default
  }

  /**
   * Start the automatic cleanup process
   */
  startCleanup(): void {
    if (this.cleanupInterval) {
      logger.warn('Session cleanup already started');
      return;
    }

    logger.info({ cleanupIntervalMs: this.cleanupIntervalMs }, 'Starting session cleanup');

    this.cleanupInterval = setInterval(() => {
      this.performCleanup().catch((error) => {
        logger.error({ error }, 'Session cleanup failed');
      });
    }, this.cleanupIntervalMs);

    // Perform initial cleanup
    this.performCleanup().catch((error) => {
      logger.error({ error }, 'Initial session cleanup failed');
    });
  }

  /**
   * Stop the automatic cleanup process
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Session cleanup stopped');
    }
  }

  /**
   * Perform manual cleanup of expired sessions
   */
  async performCleanup(): Promise<number> {
    const cleanedCount = this.sessionRepo.cleanupExpiredSessions();

    if (cleanedCount > 0) {
      logger.info({ cleanedCount }, 'Cleaned up expired sessions');
    }

    return cleanedCount;
  }

  /**
   * Get all active sessions with their status
   */
  getActiveSessions(): Array<{
    id: string;
    taskId: string;
    agentId: string;
    model: string;
    status: string;
    expiresAt: string;
    lastActivityAt: string;
    createdAt: string;
    isExpired: boolean;
    hoursUntilExpiry: number;
  }> {
    const sessions = this.sessionRepo.findActiveSessions();
    const now = Date.now();

    return sessions.map(session => {
      const expiresAtMs = new Date(session.expiresAt).getTime();
      const isExpired = now > expiresAtMs;
      const hoursUntilExpiry = Math.max(0, (expiresAtMs - now) / (1000 * 60 * 60));

      return {
        id: session.id,
        taskId: session.taskId,
        agentId: session.agentId,
        model: session.model,
        status: session.status,
        expiresAt: session.expiresAt,
        lastActivityAt: session.lastActivityAt,
        createdAt: session.createdAt,
        isExpired,
        hoursUntilExpiry: Math.round(hoursUntilExpiry * 100) / 100, // Round to 2 decimal places
      };
    });
  }

  /**
   * Get expired sessions that haven't been cleaned up yet
   */
  getExpiredSessions() {
    return this.sessionRepo.findExpired();
  }

  /**
   * Invalidate a specific session
   */
  invalidateSession(sessionId: string) {
    return this.sessionRepo.invalidateSession(sessionId);
  }

  /**
   * Update last activity timestamp for a session
   */
  updateLastActivity(sessionId: string) {
    return this.sessionRepo.updateLastActivity(sessionId);
  }

  /**
   * Extend a session's expiration time
   */
  extendSession(sessionId: string, hoursToAdd: number = 24) {
    return this.sessionRepo.extendSession(sessionId, hoursToAdd);
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalActive: number;
    totalExpired: number;
    expiringSoon: number; // Sessions expiring within 1 hour
    byAgent: Record<string, number>;
    byModel: Record<string, number>;
  } {
    const activeSessions = this.getActiveSessions();
    const expiredSessions = this.getExpiredSessions();

    const now = Date.now();
    const oneHourFromNow = now + (60 * 60 * 1000);

    const expiringSoon = activeSessions.filter(session =>
      new Date(session.expiresAt).getTime() <= oneHourFromNow
    ).length;

    const byAgent: Record<string, number> = {};
    const byModel: Record<string, number> = {};

    activeSessions.forEach(session => {
      byAgent[session.agentId] = (byAgent[session.agentId] || 0) + 1;
      byModel[session.model] = (byModel[session.model] || 0) + 1;
    });

    return {
      totalActive: activeSessions.length,
      totalExpired: expiredSessions.length,
      expiringSoon,
      byAgent,
      byModel,
    };
  }
}