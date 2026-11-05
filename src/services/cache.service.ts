import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tags: Set<string>;
  accessedAt: number;
  accessOrder: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRatio: number;
}

export interface ICacheService {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttlMs?: number, tags?: string[]): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  invalidateByTag(tag: string): number;
  invalidateAll(): void;
  getStats(): CacheStats;
  resetStats(): void;
}

/**
 * In-memory cache supporting TTL, tag-based invalidation, LRU pruning, and statistics.
 */
export class CacheService implements ICacheService {
  private readonly store: Map<string, CacheEntry<unknown>> = new Map();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  private hits: number = 0;
  private misses: number = 0;
  private accessCounter: number = 0;

  constructor(defaultTtlMs: number = env.CACHE_TTL_MS, maxEntries: number = env.CACHE_MAX_ENTRIES) {
    this.defaultTtlMs = defaultTtlMs;
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      this.misses++;
      return undefined;
    }

    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    entry.accessedAt = now;
    entry.accessOrder = ++this.accessCounter;
    logger.debug(`[Cache] HIT for key: ${key}`);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = this.defaultTtlMs, tags: string[] = []): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictOldest();
    }

    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + ttlMs,
      tags: new Set(tags),
      accessedAt: now,
      accessOrder: ++this.accessCounter,
    });

    logger.debug(`[Cache] SET key: ${key} (ttl: ${ttlMs}ms, tags: ${tags.join(',')})`);
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  invalidateByTag(tag: string): number {
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (entry.tags.has(tag)) {
        this.store.delete(key);
        count++;
      }
    }
    logger.info(`[Cache] Invalidated ${count} entries with tag '${tag}'`);
    return count;
  }

  invalidateAll(): void {
    const count = this.store.size;
    this.store.clear();
    logger.info(`[Cache] Invalidation complete. Cleared all ${count} entries`);
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRatio = total > 0 ? parseFloat((this.hits / total).toFixed(4)) : 0;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      hitRatio,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestOrder = Infinity;
    const now = Date.now();

    for (const [key, entry] of this.store.entries()) {
      // Clear expired entries first before evicting active ones
      if (entry.expiresAt <= now) {
        this.store.delete(key);
        return;
      }
      if (entry.accessOrder < oldestOrder) {
        oldestOrder = entry.accessOrder;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }
}

export const cacheService = new CacheService();
