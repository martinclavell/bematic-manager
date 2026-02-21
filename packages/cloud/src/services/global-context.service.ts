import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYAML } from 'yaml';
import { createLogger, generateId, MemoryCache } from '@bematic/common';
import type { GlobalContextRepository, AuditLogRepository, GlobalContextRow, GlobalContextInsert } from '@bematic/db';

const logger = createLogger('global-context-service');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FileContext {
  category: string;
  name: string;
  enabled: boolean;
  priority: number;
  content: string;
}

/**
 * Manages global Claude context composition
 *
 * Architecture:
 * 1. File-based defaults (version-controlled, easy to edit)
 * 2. Database overrides (runtime modifications via admin commands)
 * 3. Project-level customizations (optional per-project contexts)
 * 4. Caching layer (avoid rebuilding on every task)
 *
 * Merge strategy:
 * - Load file contexts first
 * - Override with database contexts (matching category+name)
 * - Apply project-specific contexts
 * - Sort by priority, then concatenate
 */
export class GlobalContextService {
  private fileContexts: FileContext[] = [];
  private cache: MemoryCache;
  private readonly CONFIG_PATH = join(__dirname, '../../config/global-contexts.yaml');

  constructor(
    private readonly globalContextRepo: GlobalContextRepository,
    private readonly auditLogRepo: AuditLogRepository,
  ) {
    // Cache for 5 minutes (300000 ms)
    this.cache = new MemoryCache({ defaultTtl: 300000 });
    this.loadFileContexts();
  }

  /**
   * Load contexts from YAML config file
   */
  private loadFileContexts(): void {
    try {
      const yamlContent = readFileSync(this.CONFIG_PATH, 'utf-8');
      this.fileContexts = parseYAML(yamlContent) || [];
      logger.info(
        { count: this.fileContexts.length, path: this.CONFIG_PATH },
        'Loaded file-based global contexts',
      );
    } catch (error) {
      logger.warn(
        { error, path: this.CONFIG_PATH },
        'Failed to load global contexts config file, using empty defaults',
      );
      this.fileContexts = [];
    }
  }

  /**
   * Reload file contexts (useful after config changes)
   */
  reloadFileContexts(): void {
    this.loadFileContexts();
    this.cache.clear();
    logger.info('Reloaded file contexts and cleared cache');
  }

  /**
   * Get all active contexts for a project (or global if projectId is null)
   * Uses caching to avoid repeated database queries
   */
  getActiveContexts(projectId?: string): GlobalContextRow[] {
    const cacheKey = projectId ? `project:${projectId}` : 'global';

    // Note: We don't cache the actual contexts because they need to be fresh
    // from the database. We only cache the composed output.

    if (projectId) {
      return this.globalContextRepo.findActiveForProject(projectId);
    } else {
      return this.globalContextRepo.findActiveGlobal();
    }
  }

  /**
   * Build the complete global prompt by composing all active contexts
   * Returns a formatted string ready to prepend to system prompts
   */
  buildGlobalPrompt(projectId?: string): string {
    const cacheKey = projectId ? `prompt:${projectId}` : 'prompt:global';

    // Check cache first
    const cached = this.cache.get<string>(cacheKey);
    if (cached) {
      logger.debug({ projectId, cacheHit: true }, 'Using cached global prompt');
      return cached;
    }

    // Merge file contexts + database contexts
    const merged = this.mergeContexts(projectId);

    if (merged.length === 0) {
      logger.debug({ projectId }, 'No active global contexts found');
      return '';
    }

    // Build formatted prompt
    const sections = merged.map((ctx) => {
      return `### ${ctx.name} (${ctx.category})\n\n${ctx.content.trim()}`;
    });

    const prompt = `# Global Context\n\n${sections.join('\n\n---\n\n')}\n`;

    // Cache the result
    this.cache.set(cacheKey, prompt);

    logger.info(
      {
        projectId,
        contextCount: merged.length,
        totalLength: prompt.length,
        categories: [...new Set(merged.map((c) => c.category))],
      },
      'Built global prompt',
    );

    return prompt;
  }

  /**
   * Merge file-based and database contexts
   * Database contexts override file contexts with matching category+name
   */
  private mergeContexts(projectId?: string): Array<{
    category: string;
    name: string;
    priority: number;
    content: string;
  }> {
    // Get database contexts
    const dbContexts = projectId
      ? this.globalContextRepo.findActiveForProject(projectId)
      : this.globalContextRepo.findActiveGlobal();

    // Create a map of database contexts by category+name
    const dbMap = new Map<string, GlobalContextRow>();
    for (const ctx of dbContexts) {
      const key = `${ctx.category}:${ctx.name}`;
      dbMap.set(key, ctx);
    }

    // Start with enabled file contexts
    const fileEnabled = this.fileContexts
      .filter((ctx) => ctx.enabled)
      .map((ctx) => {
        const key = `${ctx.category}:${ctx.name}`;
        const dbOverride = dbMap.get(key);

        // If database has an override, use it; otherwise use file context
        if (dbOverride) {
          dbMap.delete(key); // Mark as processed
          return {
            category: dbOverride.category,
            name: dbOverride.name,
            priority: dbOverride.priority,
            content: dbOverride.content,
          };
        }

        return {
          category: ctx.category,
          name: ctx.name,
          priority: ctx.priority,
          content: ctx.content,
        };
      });

    // Add remaining database contexts that weren't in file
    const dbOnly = Array.from(dbMap.values()).map((ctx) => ({
      category: ctx.category,
      name: ctx.name,
      priority: ctx.priority,
      content: ctx.content,
    }));

    // Merge and sort by priority
    const merged = [...fileEnabled, ...dbOnly].sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority number = higher precedence
      }
      return a.name.localeCompare(b.name);
    });

    return merged;
  }

  /**
   * Create a new global context (database only)
   */
  create(
    data: {
      category: string;
      name: string;
      content: string;
      enabled?: boolean;
      priority?: number;
      scope?: 'global' | 'project';
      projectId?: string;
    },
    userId?: string,
  ): GlobalContextRow {
    const context = this.globalContextRepo.create({
      id: generateId('gctx'),
      category: data.category,
      name: data.name,
      content: data.content,
      enabled: data.enabled ?? true,
      priority: data.priority ?? 100,
      scope: data.scope ?? 'global',
      projectId: data.projectId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    this.auditLogRepo.log('global_context:created', 'global_context', context.id, userId, {
      category: data.category,
      name: data.name,
    });

    // Clear cache
    this.cache.clear();

    logger.info({ contextId: context.id, category: data.category, name: data.name }, 'Global context created');
    return context;
  }

  /**
   * Update an existing context
   */
  update(
    id: string,
    data: Partial<{
      content: string;
      enabled: boolean;
      priority: number;
      category: string;
      name: string;
    }>,
    userId?: string,
  ): GlobalContextRow {
    const updated = this.globalContextRepo.update(id, data);

    this.auditLogRepo.log('global_context:updated', 'global_context', id, userId, data);

    // Clear cache
    this.cache.clear();

    logger.info({ contextId: id }, 'Global context updated');
    return updated;
  }

  /**
   * Enable or disable a context
   */
  setEnabled(id: string, enabled: boolean, userId?: string): GlobalContextRow {
    const updated = this.globalContextRepo.setEnabled(id, enabled);

    this.auditLogRepo.log(
      enabled ? 'global_context:enabled' : 'global_context:disabled',
      'global_context',
      id,
      userId,
    );

    // Clear cache
    this.cache.clear();

    logger.info({ contextId: id, enabled }, 'Global context enabled status changed');
    return updated;
  }

  /**
   * Delete a context
   */
  delete(id: string, userId?: string): void {
    this.globalContextRepo.delete(id);

    this.auditLogRepo.log('global_context:deleted', 'global_context', id, userId);

    // Clear cache
    this.cache.clear();

    logger.info({ contextId: id }, 'Global context deleted');
  }

  /**
   * List all contexts (file + database merged)
   */
  listAll(projectId?: string): Array<{
    id?: string;
    category: string;
    name: string;
    enabled: boolean;
    priority: number;
    scope: string;
    source: 'file' | 'database';
    projectId?: string | null;
  }> {
    const dbContexts = projectId
      ? this.globalContextRepo.findActiveForProject(projectId)
      : this.globalContextRepo.findAll();

    const dbMap = new Map<string, GlobalContextRow>();
    for (const ctx of dbContexts) {
      const key = `${ctx.category}:${ctx.name}`;
      dbMap.set(key, ctx);
    }

    // File contexts
    const fileList = this.fileContexts.map((ctx) => {
      const key = `${ctx.category}:${ctx.name}`;
      const dbOverride = dbMap.get(key);

      if (dbOverride) {
        dbMap.delete(key);
        return {
          id: dbOverride.id,
          category: dbOverride.category,
          name: dbOverride.name,
          enabled: dbOverride.enabled,
          priority: dbOverride.priority,
          scope: dbOverride.scope,
          source: 'database' as const,
          projectId: dbOverride.projectId,
        };
      }

      return {
        category: ctx.category,
        name: ctx.name,
        enabled: ctx.enabled,
        priority: ctx.priority,
        scope: 'global',
        source: 'file' as const,
      };
    });

    // Database-only contexts
    const dbOnlyList = Array.from(dbMap.values()).map((ctx) => ({
      id: ctx.id,
      category: ctx.category,
      name: ctx.name,
      enabled: ctx.enabled,
      priority: ctx.priority,
      scope: ctx.scope,
      source: 'database' as const,
      projectId: ctx.projectId,
    }));

    return [...fileList, ...dbOnlyList].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get statistics about global contexts
   */
  getStats(): {
    totalContexts: number;
    enabledContexts: number;
    fileContexts: number;
    databaseContexts: number;
    categories: string[];
    cacheSize: number;
  } {
    const dbContexts = this.globalContextRepo.findAll();
    const enabledContexts = dbContexts.filter((c) => c.enabled).length +
                           this.fileContexts.filter((c) => c.enabled).length;

    const allCategories = new Set([
      ...this.fileContexts.map((c) => c.category),
      ...dbContexts.map((c) => c.category),
    ]);

    return {
      totalContexts: this.fileContexts.length + dbContexts.length,
      enabledContexts,
      fileContexts: this.fileContexts.length,
      databaseContexts: dbContexts.length,
      categories: Array.from(allCategories).sort(),
      cacheSize: this.cache.size(),
    };
  }
}
