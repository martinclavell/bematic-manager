import { createLogger } from '@bematic/common';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { mkdirSync, existsSync, statSync } from 'fs';

const logger = createLogger('temp-file-manager');

interface TrackedFile {
  path: string;
  createdAt: number;
  size: number;
  taskId?: string;
}

export class TempFileManager {
  private trackedFiles = new Map<string, TrackedFile>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly maxAgeMs: number;
  private readonly maxTotalSizeMB: number;
  private readonly cleanupIntervalMs: number;

  constructor(options: {
    maxAgeHours?: number;
    maxTotalSizeMB?: number;
    cleanupIntervalMs?: number;
  } = {}) {
    this.maxAgeMs = (options.maxAgeHours || 24) * 60 * 60 * 1000; // 24 hours default
    this.maxTotalSizeMB = options.maxTotalSizeMB || 1000; // 1GB default
    this.cleanupIntervalMs = options.cleanupIntervalMs || 600000; // 10 minutes default

    this.startCleanup();
  }

  /**
   * Track a file for cleanup
   */
  trackFile(filePath: string, taskId?: string): void {
    try {
      if (!existsSync(filePath)) {
        logger.warn({ filePath }, 'Attempted to track non-existent file');
        return;
      }

      const stats = statSync(filePath);
      const trackedFile: TrackedFile = {
        path: filePath,
        createdAt: Date.now(),
        size: stats.size,
        taskId
      };

      this.trackedFiles.set(filePath, trackedFile);
      logger.debug({ filePath, size: stats.size, taskId }, 'File tracked for cleanup');

      // Check if we need immediate cleanup due to size constraints
      this.checkSizeLimit();
    } catch (error) {
      logger.error({ error, filePath }, 'Failed to track file');
    }
  }

  /**
   * Untrack a file (usually when it's been processed successfully)
   */
  untrackFile(filePath: string): void {
    if (this.trackedFiles.delete(filePath)) {
      logger.debug({ filePath }, 'File untracked');
    }
  }

  /**
   * Save an attachment and track it
   */
  async saveAttachment(
    content: Buffer | string,
    filename: string,
    tempDir: string,
    taskId?: string
  ): Promise<string> {
    try {
      // Ensure temp directory exists
      if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
      }

      // Create unique filename to avoid conflicts
      const timestamp = Date.now();
      const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = join(tempDir, `${timestamp}_${safeName}`);

      await fs.writeFile(filePath, content);

      // Track the file
      this.trackFile(filePath, taskId);

      logger.info({ filePath, filename, size: content.length, taskId }, 'Attachment saved and tracked');
      return filePath;
    } catch (error) {
      logger.error({ error, filename, taskId }, 'Failed to save attachment');
      throw error;
    }
  }

  /**
   * Clean up files for a specific task
   */
  async cleanupTaskFiles(taskId: string): Promise<number> {
    let cleanedCount = 0;

    for (const [filePath, trackedFile] of this.trackedFiles.entries()) {
      if (trackedFile.taskId === taskId) {
        try {
          await fs.unlink(filePath);
          this.trackedFiles.delete(filePath);
          cleanedCount++;
          logger.debug({ filePath, taskId }, 'Task file cleaned up');
        } catch (error) {
          logger.warn({ error, filePath, taskId }, 'Failed to clean up task file');
          // Remove from tracking even if deletion failed
          this.trackedFiles.delete(filePath);
        }
      }
    }

    if (cleanedCount > 0) {
      logger.info({ taskId, cleanedCount }, 'Cleaned up task files');
    }

    return cleanedCount;
  }

  /**
   * Start automatic cleanup process
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup().catch((error) => {
        logger.error({ error }, 'Automatic cleanup failed');
      });
    }, this.cleanupIntervalMs);

    logger.info({
      maxAgeMs: this.maxAgeMs,
      maxTotalSizeMB: this.maxTotalSizeMB,
      cleanupIntervalMs: this.cleanupIntervalMs
    }, 'Started automatic temp file cleanup');
  }

  /**
   * Stop automatic cleanup
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Stopped temp file cleanup');
    }
  }

  /**
   * Perform cleanup of old files
   */
  async performCleanup(): Promise<{ deletedFiles: number; freedSizeMB: number }> {
    const now = Date.now();
    let deletedFiles = 0;
    let freedBytes = 0;

    const filesToDelete: string[] = [];

    // Find files that are too old
    for (const [filePath, trackedFile] of this.trackedFiles.entries()) {
      if (now - trackedFile.createdAt > this.maxAgeMs) {
        filesToDelete.push(filePath);
      }
    }

    // Delete old files
    for (const filePath of filesToDelete) {
      try {
        const trackedFile = this.trackedFiles.get(filePath);
        if (trackedFile) {
          await fs.unlink(filePath);
          this.trackedFiles.delete(filePath);
          deletedFiles++;
          freedBytes += trackedFile.size;
          logger.debug({ filePath, age: now - trackedFile.createdAt }, 'Old file cleaned up');
        }
      } catch (error) {
        logger.warn({ error, filePath }, 'Failed to clean up old file');
        // Remove from tracking even if deletion failed
        this.trackedFiles.delete(filePath);
      }
    }

    const freedSizeMB = freedBytes / (1024 * 1024);

    if (deletedFiles > 0) {
      logger.info({ deletedFiles, freedSizeMB: Math.round(freedSizeMB * 100) / 100 }, 'Cleanup completed');
    }

    return { deletedFiles, freedSizeMB };
  }

  /**
   * Check and enforce size limit
   */
  private async checkSizeLimit(): Promise<void> {
    const totalSizeBytes = Array.from(this.trackedFiles.values()).reduce((sum, file) => sum + file.size, 0);
    const totalSizeMB = totalSizeBytes / (1024 * 1024);

    if (totalSizeMB > this.maxTotalSizeMB) {
      logger.warn({ totalSizeMB, maxTotalSizeMB: this.maxTotalSizeMB }, 'Size limit exceeded, performing LRU cleanup');

      // Sort files by creation time (oldest first)
      const sortedFiles = Array.from(this.trackedFiles.entries()).sort(
        ([, a], [, b]) => a.createdAt - b.createdAt
      );

      let currentSizeBytes = totalSizeBytes;
      let deletedFiles = 0;

      for (const [filePath, trackedFile] of sortedFiles) {
        if (currentSizeBytes / (1024 * 1024) <= this.maxTotalSizeMB) {
          break;
        }

        try {
          await fs.unlink(filePath);
          this.trackedFiles.delete(filePath);
          currentSizeBytes -= trackedFile.size;
          deletedFiles++;
          logger.debug({ filePath, size: trackedFile.size }, 'File evicted due to size limit');
        } catch (error) {
          logger.warn({ error, filePath }, 'Failed to evict file');
          this.trackedFiles.delete(filePath);
          currentSizeBytes -= trackedFile.size;
        }
      }

      if (deletedFiles > 0) {
        const newSizeMB = currentSizeBytes / (1024 * 1024);
        logger.info({ deletedFiles, newSizeMB: Math.round(newSizeMB * 100) / 100 }, 'Size limit enforcement completed');
      }
    }
  }

  /**
   * Get statistics about tracked files
   */
  getStats(): {
    totalFiles: number;
    totalSizeMB: number;
    oldestFileAge: number;
    byTask: Record<string, number>;
  } {
    const files = Array.from(this.trackedFiles.values());
    const totalSizeBytes = files.reduce((sum, file) => sum + file.size, 0);
    const now = Date.now();

    const oldestFile = files.reduce((oldest, file) =>
      file.createdAt < (oldest?.createdAt || now) ? file : oldest, null as TrackedFile | null);

    const byTask: Record<string, number> = {};
    files.forEach(file => {
      if (file.taskId) {
        byTask[file.taskId] = (byTask[file.taskId] || 0) + 1;
      }
    });

    return {
      totalFiles: files.length,
      totalSizeMB: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
      oldestFileAge: oldestFile ? now - oldestFile.createdAt : 0,
      byTask
    };
  }

  /**
   * Get list of tracked files with details
   */
  getTrackedFiles(): Array<{
    path: string;
    createdAt: string;
    sizeMB: number;
    taskId?: string;
    ageHours: number;
  }> {
    const now = Date.now();
    return Array.from(this.trackedFiles.values()).map(file => ({
      path: file.path,
      createdAt: new Date(file.createdAt).toISOString(),
      sizeMB: Math.round((file.size / (1024 * 1024)) * 100) / 100,
      taskId: file.taskId,
      ageHours: Math.round(((now - file.createdAt) / (1000 * 60 * 60)) * 100) / 100
    }));
  }

  /**
   * Manually clean up all tracked files
   */
  async cleanupAll(): Promise<{ deletedFiles: number; freedSizeMB: number }> {
    let deletedFiles = 0;
    let freedBytes = 0;

    for (const [filePath, trackedFile] of this.trackedFiles.entries()) {
      try {
        await fs.unlink(filePath);
        deletedFiles++;
        freedBytes += trackedFile.size;
      } catch (error) {
        logger.warn({ error, filePath }, 'Failed to delete file during manual cleanup');
      }
    }

    // Clear all tracking
    this.trackedFiles.clear();

    const freedSizeMB = freedBytes / (1024 * 1024);
    logger.info({ deletedFiles, freedSizeMB: Math.round(freedSizeMB * 100) / 100 }, 'Manual cleanup all completed');

    return { deletedFiles, freedSizeMB };
  }
}