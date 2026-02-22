/**
 * A Map with a maximum size and TTL-based expiry.
 * When the size limit is reached, the oldest entry (by `createdAt`) is evicted.
 */
export interface BoundedEntry {
  createdAt: number;
}

export class BoundedMap<K, V extends BoundedEntry> extends Map<K, V> {
  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
  ) {
    super();
  }

  override set(key: K, value: V): this {
    if (this.size >= this.maxSize && !this.has(key)) {
      this.evictOldest();
    }
    return super.set(key, value);
  }

  /** Remove entries older than ttlMs. Returns the number of entries removed. */
  evictExpired(): number {
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [key, value] of this.entries()) {
      if (value.createdAt < cutoff) {
        this.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private evictOldest(): void {
    let oldestKey: K | undefined;
    let oldestTime = Infinity;
    for (const [key, value] of this.entries()) {
      if (value.createdAt < oldestTime) {
        oldestTime = value.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.delete(oldestKey);
    }
  }
}
