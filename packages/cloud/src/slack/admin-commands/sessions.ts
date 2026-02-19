import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';
import type { SessionService } from '../../services/session.service.js';

const logger = createLogger('admin:sessions');

export class SessionCommands {
  constructor(
    private readonly ctx: AppContext,
    private readonly sessionService: SessionService
  ) {}

  async handleSessionsCommand(args: string[]): Promise<string> {
    if (args.length === 0) {
      return this.getSessionsHelp();
    }

    const command = args[0];
    const commandArgs = args.slice(1);

    switch (command) {
      case 'list':
        return this.listSessions(commandArgs);
      case 'invalidate':
        return this.invalidateSession(commandArgs);
      case 'extend':
        return this.extendSession(commandArgs);
      case 'cleanup':
        return this.performCleanup();
      case 'stats':
        return this.getStats();
      default:
        return this.getSessionsHelp();
    }
  }

  private getSessionsHelp(): string {
    return `*Session Management Commands:*
\`/bm-admin sessions list [limit]\` - List active sessions (optional limit, default 20)
\`/bm-admin sessions invalidate <session-id>\` - Invalidate a specific session
\`/bm-admin sessions extend <session-id> [hours]\` - Extend session expiration (default 24 hours)
\`/bm-admin sessions cleanup\` - Manually clean up expired sessions
\`/bm-admin sessions stats\` - Show session statistics`;
  }

  private listSessions(args: string[]): string {
    const limit = args.length > 0 ? parseInt(args[0]) || 20 : 20;
    const sessions = this.sessionService.getActiveSessions();

    if (sessions.length === 0) {
      return ':information_source: No active sessions found';
    }

    const displaySessions = sessions.slice(0, limit);
    const header = `*Active Sessions (${displaySessions.length}${sessions.length > limit ? ` of ${sessions.length}` : ''}):*\n`;

    const lines = displaySessions.map(session => {
      const statusEmoji = session.isExpired ? ':red_circle:' :
                          session.hoursUntilExpiry < 1 ? ':yellow_circle:' : ':green_circle:';
      const expiryText = session.isExpired ? 'Expired' :
                        session.hoursUntilExpiry < 1 ? `${Math.round(session.hoursUntilExpiry * 60)}m` :
                        `${Math.round(session.hoursUntilExpiry)}h`;

      return `${statusEmoji} \`${session.id.slice(0, 8)}\` - ${session.model} (${session.agentId.slice(0, 8)}) - ${expiryText}`;
    });

    const footer = sessions.length > limit ? `\n_Use \`list ${Math.min(sessions.length, limit + 20)}\` to see more_` : '';

    return header + lines.join('\n') + footer;
  }

  private async invalidateSession(args: string[]): Promise<string> {
    if (args.length === 0) {
      return ':x: Please provide a session ID: `/bm-admin sessions invalidate <session-id>`';
    }

    const sessionId = args[0];

    try {
      const session = this.sessionService.invalidateSession(sessionId);
      if (!session) {
        return `:warning: Session \`${sessionId}\` not found`;
      }

      logger.info({ sessionId, taskId: session.taskId }, 'Session invalidated by admin');
      return `:white_check_mark: Session \`${sessionId}\` has been invalidated`;

    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to invalidate session');
      return `:x: Failed to invalidate session: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async extendSession(args: string[]): Promise<string> {
    if (args.length === 0) {
      return ':x: Please provide a session ID: `/bm-admin sessions extend <session-id> [hours]`';
    }

    const sessionId = args[0];
    const hours = args.length > 1 ? parseFloat(args[1]) : 24;

    if (isNaN(hours) || hours <= 0) {
      return ':x: Hours must be a positive number';
    }

    try {
      const session = this.sessionService.extendSession(sessionId, hours);
      if (!session) {
        return `:warning: Session \`${sessionId}\` not found`;
      }

      const newExpiry = new Date(session.expiresAt).toLocaleString();
      logger.info({ sessionId, hours, newExpiry }, 'Session extended by admin');
      return `:white_check_mark: Session \`${sessionId}\` extended by ${hours} hours (expires: ${newExpiry})`;

    } catch (error) {
      logger.error({ error, sessionId, hours }, 'Failed to extend session');
      return `:x: Failed to extend session: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private async performCleanup(): Promise<string> {
    try {
      const cleanedCount = await this.sessionService.performCleanup();

      if (cleanedCount === 0) {
        return ':information_source: No expired sessions to clean up';
      }

      logger.info({ cleanedCount }, 'Manual session cleanup performed by admin');
      return `:white_check_mark: Cleaned up ${cleanedCount} expired session${cleanedCount === 1 ? '' : 's'}`;

    } catch (error) {
      logger.error({ error }, 'Failed to perform session cleanup');
      return `:x: Failed to clean up sessions: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private getStats(): string {
    const stats = this.sessionService.getSessionStats();

    const agentStats = Object.entries(stats.byAgent)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5) // Top 5 agents
      .map(([agent, count]) => `  • ${agent.slice(0, 8)}: ${count}`)
      .join('\n');

    const modelStats = Object.entries(stats.byModel)
      .sort(([, a], [, b]) => b - a)
      .map(([model, count]) => `  • ${model}: ${count}`)
      .join('\n');

    return `*Session Statistics:*

:green_circle: **Active Sessions:** ${stats.totalActive}
:red_circle: **Expired (pending cleanup):** ${stats.totalExpired}
:yellow_circle: **Expiring soon (< 1 hour):** ${stats.expiringSoon}

**By Agent (top 5):**
${agentStats || '  _None_'}

**By Model:**
${modelStats || '  _None_'}`;
  }
}