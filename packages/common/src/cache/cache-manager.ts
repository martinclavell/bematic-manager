export interface CacheEntry<T = any> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hitCount: number;
  lastAccessedAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  hitRate: number;
  memoryUsage: number;
}

export interface CacheOptions {
  /**
   * Default TTL in milliseconds
   */
  defaultTtl: number;
  /**
   * Maximum number of entries before eviction
   */
  maxSize: number;
  /**
   * Enable cache statistics tracking
   */
  enableStats: boolean;
  /**
   * Cleanup interval in milliseconds
   */
  cleanupInterval: number;
}

export abstract class CacheManager {
  protected stats = {
    hits: 0,
    misses: 0,
    entries: 0,
  };

  constructor(protected options: CacheOptions) {}

  /**
   * Set a value in the cache with optional TTL
   */
  abstract set(key: string, value: any, ttl?: number): void;

  /**
   * Get a value from the cache
   */
  abstract get<T>(key: string): T | null;

  /**
   * Check if a key exists in the cache
   */
  abstract has(key: string): boolean;

  /**
   * Delete a specific key from the cache
   */
  abstract delete(key: string): boolean;

  /**
   * Clear all entries from the cache
   */
  abstract clear(): void;

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? this.stats.hits / (this.stats.hits + this.stats.misses)
      : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      entries: this.stats.entries,
      hitRate,
      memoryUsage: this.getMemoryUsage(),
    };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
  }

  /**
   * Get estimated memory usage of the cache
   */
  abstract getMemoryUsage(): number;

  /**
   * Get all keys in the cache
   */
  abstract getKeys(): string[];

  /**
   * Get the size of the cache
   */
  abstract size(): number;

  /**
   * Set multiple entries at once
   */
  setMany(entries: Array<{ key: string; value: any; ttl?: number }>): void {
    entries.forEach(({ key, value, ttl }) => this.set(key, value, ttl));
  }

  /**
   * Get multiple entries at once
   */
  getMany<T>(keys: string[]): Array<{ key: string; value: T | null }> {
    return keys.map(key => ({ key, value: this.get<T>(key) }));
  }

  /**
   * Delete multiple keys at once
   */
  deleteMany(keys: string[]): number {
    let deleted = 0;
    keys.forEach(key => {
      if (this.delete(key)) {
        deleted++;
      }
    });
    return deleted;
  }

  /**
   * Get or set pattern - returns cached value or sets and returns new value
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T> | T,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Increment a numeric value in the cache
   */
  increment(key: string, delta = 1, ttl?: number): number {
    const current = this.get<number>(key) || 0;
    const newValue = current + delta;
    this.set(key, newValue, ttl);
    return newValue;
  }

  /**
   * Decrement a numeric value in the cache
   */
  decrement(key: string, delta = 1, ttl?: number): number {
    return this.increment(key, -delta, ttl);
  }

  /**
   * Get keys matching a pattern (basic glob support: * and ?)
   */
  getKeysMatching(pattern: string): string[] {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return this.getKeys().filter(key => regex.test(key));
  }

  /**
   * Delete keys matching a pattern
   */
  deleteMatching(pattern: string): number {
    const matchingKeys = this.getKeysMatching(pattern);
    return this.deleteMany(matchingKeys);
  }
}