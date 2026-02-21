import { createLogger } from '@bematic/common';
import type { NotificationService } from '../../services/notification.service.js';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

const logger = createLogger('admin:file-upload');

/**
 * Strip Slack's auto-link formatting from a string
 * Converts: <http://martinclavell.com|martinclavell.com> → martinclavell.com
 * Converts: <http://example.com> → http://example.com
 */
function stripSlackLinkFormatting(text: string): string {
  return text.replace(/<([^|>]+)\|([^>]+)>/g, '$2').replace(/<([^>]+)>/g, '$1');
}

export class FileUploadCommands {
  constructor(private readonly notifier: NotificationService) {}

  async handleFileUploadCommand(
    args: string[],
    channelId: string,
    threadTs?: string
  ): Promise<string> {
    if (args.length === 0) {
      return this.getHelp();
    }

    return this.uploadFile(args, channelId, threadTs);
  }

  private getHelp(): string {
    return `*File Upload Admin Commands:*
\`/bm-admin upload <file-path> [title] [comment]\` - Upload a file to current channel/thread

**Example:**
\`/bm-admin upload /path/to/report.html "SEO Report" "Your audit is ready!"\`

**Notes:**
- File path must be absolute
- Title and comment are optional
- File will be uploaded to the current channel/thread
- Maximum file size: 10MB (configurable)`;
  }

  private async uploadFile(
    args: string[],
    channelId: string,
    threadTs?: string
  ): Promise<string> {
    if (args.length === 0) {
      return '❌ Missing file path. Usage: `/bm-admin upload <file-path> [title] [comment]`';
    }

    // Strip Slack's auto-link formatting from file path
    const filePath = stripSlackLinkFormatting(args[0]!);
    const title = args[1];
    const comment = args.slice(2).join(' ') || undefined;

    // Validate file exists
    if (!existsSync(filePath)) {
      return `❌ File not found: \`${filePath}\``;
    }

    try {
      const filename = basename(filePath);

      await this.notifier.uploadFile(
        channelId,
        filePath,
        filename,
        title || filename,
        comment || `📎 File uploaded via admin command`,
        threadTs
      );

      logger.info({ filePath, channelId, threadTs }, 'File uploaded via admin command');

      return `✅ File uploaded successfully: \`${filename}\``;
    } catch (error) {
      logger.error({ error, filePath, channelId }, 'Failed to upload file via admin command');
      return `❌ Upload failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
