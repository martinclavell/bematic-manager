import { createLogger } from '@bematic/common';
import type { AppContext } from '../../context.js';

const logger = createLogger('admin:retention-commands');

type RespondFn = (message: string) => Promise<void>;

/**
 * Data retention management commands
 * - retention-stats
 * - retention-run
 */
export class RetentionCommands {
  constructor(private readonly ctx: AppContext) {}

  async retentionStats(respond: RespondFn): Promise<void> {
    const stats = await this.ctx.retentionService.getRetentionStats();

    let response = ':wastebasket: *Data Retention Statistics*\n\n';
    response += `Old Tasks (30d+): ${stats.oldTasks}\n`;
    response += `Orphaned Sessions: ${stats.orphanedSessions}\n`;
    response += `Old Audit Logs (90d+): ${stats.oldAuditLogs}\n`;
    response += `Expired Queue Entries (24h+): ${stats.expiredOfflineQueue}\n\n`;

    const total = stats.oldTasks + stats.orphanedSessions + stats.oldAuditLogs + stats.expiredOfflineQueue;
    response += `*Total records eligible for cleanup: ${total}*\n\n`;
    response += 'Use `/bm-admin retention-run` to execute cleanup.';

    await respond(response);
  }

  async retentionRun(userId: string, respond: RespondFn): Promise<void> {
    await respond(':hourglass_flowing_sand: Running retention cleanup...');

    const results = await this.ctx.retentionService.runRetentionPolicies();

    const total = results.tasksDeleted + results.sessionsDeleted + results.auditLogsDeleted + results.offlineQueueDeleted;

    let response = ':white_check_mark: *Retention Cleanup Complete*\n\n';
    response += `Tasks deleted: ${results.tasksDeleted}\n`;
    response += `Sessions deleted: ${results.sessionsDeleted}\n`;
    response += `Audit logs deleted: ${results.auditLogsDeleted}\n`;
    response += `Queue entries deleted: ${results.offlineQueueDeleted}\n\n`;
    response += `*Total records deleted: ${total}*`;

    this.ctx.auditLogRepo.log(
      'retention.cleanup',
      'system',
      null,
      userId,
      { ...results, total },
    );

    await respond(response);
  }
}
