import { config, CACHE_KEYS } from '../config.js';
import { createModuleLogger } from '../logger.js';

const logger = createModuleLogger('cache');

// In-memory cache implementation with TTL
class MemoryCache {
  private cache: Map<string, { value: unknown; expires: number }> = new Map();

  set(key: string, value: unknown, ttlSeconds: number = config.CACHE_TTL_SECONDS): void {
    const expires = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expires });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  // Cleanup expired entries
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  size(): number {
    return this.cache.size;
  }
}

// Redis client type
type RedisClient = import('ioredis').Redis;

// Redis client wrapper (optional, falls back to memory cache)
class RedisCache {
  private client: RedisClient | null = null;
  private connected: boolean = false;

  async connect(): Promise<boolean> {
    if (!config.REDIS_URL) {
      logger.info('No Redis URL configured, skipping Redis connection');
      return false;
    }

    try {
      const { Redis } = await import('ioredis');
      this.client = new Redis(config.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) return null;
          return Math.min(times * 200, 2000);
        },
      });

      this.client.on('connect', () => {
        logger.info('Redis connected');
        this.connected = true;
      });

      this.client.on('error', (err: Error) => {
        logger.error({ error: err.message }, 'Redis error');
        this.connected = false;
      });

      // Wait for connection
      const client = this.client;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 5000);

        client.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        client.once('error', (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      return true;
    } catch (error) {
      logger.warn({ error }, 'Failed to connect to Redis, using memory cache');
      this.client = null;
      this.connected = false;
      return false;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number = config.CACHE_TTL_SECONDS): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      const serialized = JSON.stringify(value);
      await this.client.setex(key, ttlSeconds, serialized);
    } catch (error) {
      logger.warn({ key, error }, 'Redis set failed');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.connected || !this.client) return null;

    try {
      const value = await this.client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn({ key, error }, 'Redis get failed');
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.connected || !this.client) return;

    try {
      await this.client.del(key);
    } catch (error) {
      logger.warn({ key, error }, 'Redis delete failed');
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// Unified cache interface with Redis + Memory fallback
export class Cache {
  private memoryCache: MemoryCache;
  private redisCache: RedisCache;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.memoryCache = new MemoryCache();
    this.redisCache = new RedisCache();
  }

  async initialize(): Promise<void> {
    await this.redisCache.connect();

    // Start cleanup interval for memory cache (every 5 minutes)
    this.cleanupInterval = setInterval(() => {
      const cleaned = this.memoryCache.cleanup();
      if (cleaned > 0) {
        logger.debug({ cleaned }, 'Memory cache cleanup');
      }
    }, 5 * 60 * 1000);
  }

  async set(key: string, value: unknown, ttlSeconds: number = config.CACHE_TTL_SECONDS): Promise<void> {
    // Always set in memory cache
    this.memoryCache.set(key, value, ttlSeconds);

    // Also set in Redis if available
    if (this.redisCache.isConnected()) {
      await this.redisCache.set(key, value, ttlSeconds);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // Try memory cache first (fastest)
    const memoryResult = this.memoryCache.get<T>(key);
    if (memoryResult !== null) {
      return memoryResult;
    }

    // Try Redis if available
    if (this.redisCache.isConnected()) {
      const redisResult = await this.redisCache.get<T>(key);
      if (redisResult !== null) {
        // Populate memory cache for next time
        this.memoryCache.set(key, redisResult);
        return redisResult;
      }
    }

    return null;
  }

  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    if (this.redisCache.isConnected()) {
      await this.redisCache.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.memoryCache.clear();
    // Note: Redis clear would require FLUSHDB which is dangerous
  }

  async shutdown(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    await this.redisCache.disconnect();
  }

  getStats(): { memorySize: number; redisConnected: boolean } {
    return {
      memorySize: this.memoryCache.size(),
      redisConnected: this.redisCache.isConnected(),
    };
  }
}

// Singleton cache instance
let cacheInstance: Cache | null = null;

export async function getCache(): Promise<Cache> {
  if (!cacheInstance) {
    cacheInstance = new Cache();
    await cacheInstance.initialize();
  }
  return cacheInstance;
}

export async function shutdownCache(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.shutdown();
    cacheInstance = null;
  }
}

// Re-export cache keys for convenience
export { CACHE_KEYS };
