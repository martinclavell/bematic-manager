import { createLogger } from '@bematic/common';
import type { NotificationService } from '../../services/notification.service.js';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

const logger = createLogger('admin:file-upload');

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

    const command = args[0];

    switch (command) {
      case 'upload':
        return this.uploadFile(args.slice(1), channelId, threadTs);
      default:
        return this.getHelp();
    }
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

    const filePath = args[0]!;
    const title = args[1];
    const comment = args[2];

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
