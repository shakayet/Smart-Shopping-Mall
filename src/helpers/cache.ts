type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private pending = new Map<string, Promise<unknown>>();
  private generation = 0;
  private readonly maxEntries: number;

  constructor(maxEntries = 1_000) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh insertion order so the size bound behaves like an LRU cache.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;

    this.removeExpired();
    this.store.delete(key);
    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Coalesces concurrent cache misses so a burst for one resource results in
   * one database query instead of one query per request.
   */
  async getOrSet<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const inFlight = this.pending.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const generation = this.generation;
    const request = loader()
      .then(value => {
        // Do not repopulate stale data if a mutation invalidated the cache
        // while the database query was still running.
        if (generation === this.generation) {
          this.set(key, value, ttlMs);
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) {
          this.pending.delete(key);
        }
      });

    this.pending.set(key, request);
    return request;
  }

  flushPrefix(prefix: string): void {
    this.generation += 1;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) {
        this.pending.delete(key);
      }
    }
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

export const cache = new TTLCache();
