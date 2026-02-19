import { CacheManager, type CacheEntry, type CacheOptions } from './cache-manager.js';

export class MemoryCache extends CacheManager {
  private cache = new Map<string, CacheEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: Partial<CacheOptions> = {}) {
    const defaultOptions: CacheOptions = {
      defaultTtl: 5 * 60 * 1000, // 5 minutes
      maxSize: 10000,
      enableStats: true,
      cleanupInterval: 60 * 1000, // 1 minute
    };

    super({ ...defaultOptions, ...options });

    // Start cleanup timer
    if (this.options.cleanupInterval > 0) {
      this.startCleanup();
    }
  }

  set(key: string, value: any, ttl?: number): void {
    const now = Date.now();
    const effectiveTtl = ttl ?? this.options.defaultTtl;
    const expiresAt = now + effectiveTtl;

    // Check if we need to evict entries due to size limit
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: now,
      hitCount: 0,
      lastAccessedAt: now,
    });

    this.stats.entries = this.cache.size;
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.options.enableStats) {
        this.stats.misses++;
      }
      return null;
    }

    const now = Date.now();

    // Check if expired
    if (entry.expiresAt <= now) {
      this.cache.delete(key);
      this.stats.entries = this.cache.size;
      if (this.options.enableStats) {
        this.stats.misses++;
      }
      return null;
    }

    // Update access statistics
    entry.hitCount++;
    entry.lastAccessedAt = now;

    if (this.options.enableStats) {
      this.stats.hits++;
    }

    return entry.value as T;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      this.stats.entries = this.cache.size;
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.entries = this.cache.size;
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.stats.entries = 0;
    this.resetStats();
  }

  getMemoryUsage(): number {
    let totalSize = 0;

    for (const [key, entry] of this.cache) {
      // Rough estimation of memory usage
      totalSize += key.length * 2; // UTF-16 string
      totalSize += JSON.stringify(entry.value).length * 2; // Rough approximation
      totalSize += 64; // Overhead for the entry object
    }

    return totalSize;
  }

  getKeys(): string[] {
    return Array.from(this.cache.keys());
  }

  size(): number {
    return this.cache.size;
  }

  /**
   * Get all entries (useful for debugging)
   */
  getEntries(): Array<{ key: string; entry: CacheEntry }> {
    return Array.from(this.cache.entries()).map(([key, entry]) => ({ key, entry }));
  }

  /**
   * Get entries sorted by various criteria
   */
  getSortedEntries(
    sortBy: 'createdAt' | 'lastAccessedAt' | 'hitCount' | 'expiresAt' = 'lastAccessedAt',
    ascending = false
  ): Array<{ key: string; entry: CacheEntry }> {
    const entries = this.getEntries();

    entries.sort((a, b) => {
      const valueA = a.entry[sortBy];
      const valueB = b.entry[sortBy];

      if (ascending) {
        return valueA - valueB;
      } else {
        return valueB - valueA;
      }
    });

    return entries;
  }

  /**
   * Remove expired entries manually
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        removed++;
      }
    }

    this.stats.entries = this.cache.size;
    return removed;
  }

  /**
   * Evict the least recently used (LRU) entry
   */
  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.entries = this.cache.size;
    }
  }

  /**
   * Evict the oldest entry by creation time
   */
  private evictOldest(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.entries = this.cache.size;
    }
  }

  /**
   * Start the cleanup timer
   */
  private startCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      const removed = this.cleanup();
      if (removed > 0) {
        // Could add logging here if needed
        // console.debug(`Cache cleanup: removed ${removed} expired entries`);
      }
    }, this.options.cleanupInterval);
  }

  /**
   * Stop the cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Update TTL for an existing entry
   */
  touch(key: string, ttl?: number): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    const now = Date.now();

    // Check if expired
    if (entry.expiresAt <= now) {
      this.cache.delete(key);
      this.stats.entries = this.cache.size;
      return false;
    }

    // Update expiration time
    const effectiveTtl = ttl ?? this.options.defaultTtl;
    entry.expiresAt = now + effectiveTtl;
    entry.lastAccessedAt = now;

    return true;
  }

  /**
   * Get cache entry metadata without accessing the value
   */
  getEntryInfo(key: string): Pick<CacheEntry, 'createdAt' | 'expiresAt' | 'hitCount' | 'lastAccessedAt'> | null {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();

    // Check if expired
    if (entry.expiresAt <= now) {
      this.cache.delete(key);
      this.stats.entries = this.cache.size;
      return null;
    }

    return {
      createdAt: entry.createdAt,
      expiresAt: entry.expiresAt,
      hitCount: entry.hitCount,
      lastAccessedAt: entry.lastAccessedAt,
    };
  }

  /**
   * Cleanup method to call when shutting down
   */
  destroy(): void {
    this.stopCleanup();
    this.clear();
  }
}